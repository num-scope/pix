use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

type Reply = oneshot::Sender<Result<Value, String>>;
struct Inner {
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<String, Reply>>,
    failure: Mutex<Option<String>>,
    ready: AtomicBool,
    next: AtomicU64,
}
pub struct Sidecar {
    inner: Arc<Inner>,
    child: Mutex<Child>,
}

impl Inner {
    fn write(&self, value: Value) -> Result<(), String> {
        let mut stdin = self.stdin.lock().map_err(|e| e.to_string())?;
        let bytes = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
        stdin
            .write_all(&bytes)
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|e| e.to_string())
    }
    fn fail(&self, error: String) {
        *self.failure.lock().unwrap() = Some(error.clone());
        for (_, reply) in self.pending.lock().unwrap().drain() {
            let _ = reply.send(Err(error.clone()));
        }
    }
}
impl Sidecar {
    pub fn start(app: AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let resources = app.path().resource_dir()?;
        let root = if cfg!(debug_assertions) {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
        } else {
            resources.join("sidecar")
        };
        let binary = if cfg!(debug_assertions) {
            // Prepared from this build's Node executable, never a bare `node` lookup.
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("binaries")
                .join(if cfg!(windows) {
                    "node.exe"
                } else {
                    "node"
                })
        } else {
            std::env::current_exe()?
                .parent()
                .ok_or("No executable directory")?
                .join(if cfg!(windows) {
                    "node.exe"
                } else {
                    "node"
                })
        };
        let data = match std::env::var_os("PIX_DATA_DIR") {
            Some(path) => PathBuf::from(path),
            None => app.path().app_data_dir()?,
        };
        std::fs::create_dir_all(&data)?;
        let documents = match std::env::var_os("PIX_DOCUMENTS_DIR") {
            Some(path) => PathBuf::from(path),
            None => app.path().document_dir()?,
        };
        let mut command = node_command(
            &binary,
            &root,
            if cfg!(debug_assertions) {
                &root
            } else {
                &resources
            },
            &data,
            &documents,
            !cfg!(debug_assertions),
        );
        let mut child = command.spawn()?;
        let inner = Arc::new(Inner {
            stdin: Mutex::new(child.stdin.take().ok_or("Missing stdin")?),
            pending: Mutex::new(HashMap::new()),
            failure: Mutex::new(None),
            ready: AtomicBool::new(false),
            next: AtomicU64::new(1),
        });
        let stderr = child.stderr.take().ok_or("Missing stderr")?;
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                eprintln!("[pix-agent] {line}");
            }
        });
        let stdout = child.stdout.take().ok_or("Missing stdout")?;
        let reader_inner = inner.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut frame = Vec::new();
                // Limit each JSON frame, including large image previews, to 64 MiB.
                match Read::by_ref(&mut reader)
                    .take(64 * 1024 * 1024 + 1)
                    .read_until(b'\n', &mut frame)
                {
                    Ok(0) | Err(_) => break,
                    Ok(_) if frame.len() > 64 * 1024 * 1024 => break,
                    Ok(_) => {}
                }
                let Ok(message) = serde_json::from_slice::<Value>(&frame) else {
                    continue;
                };
                if message["version"] != 1 {
                    continue;
                }
                match message["kind"].as_str() {
                    Some("ready") => {
                        reader_inner.ready.store(true, Ordering::Release);
                    }
                    Some("response") => {
                        if let Some(id) = message["id"].as_str() {
                            if let Some(reply) = reader_inner.pending.lock().unwrap().remove(id) {
                                let result = match message["error"].as_str() {
                                    Some(error) => Err(error.to_owned()),
                                    None => Ok(message["result"].clone()),
                                };
                                let _ = reply.send(result);
                            }
                        }
                    }
                    Some("event") => {
                        let _ = app.emit("pix:event", &message);
                    }
                    Some("native") => {
                        let native_app = app.clone();
                        let native_inner = reader_inner.clone();
                        tauri::async_runtime::spawn(async move {
                            let method = message["method"].as_str().unwrap_or("");
                            let result = crate::native::request(
                                native_app,
                                method,
                                message["params"].clone(),
                            )
                            .await;
                            let frame = match result {
                                Ok(value) => {
                                    json!({"version":1,"kind":"native-response","id":message["id"],"result":value})
                                }
                                Err(error) => {
                                    json!({"version":1,"kind":"native-response","id":message["id"],"error":error})
                                }
                            };
                            let _ = native_inner.write(frame);
                        });
                    }
                    _ => {}
                }
            }
            let error = "Node Agent Sidecar exited. Restart Pix to reconnect.".to_string();
            reader_inner.fail(error.clone());
            let _ = app.emit("pix:event", json!({"channel":"pix:host:event","payload":{
                "protocolVersion":1,"type":"host.crashed","hostId":"sidecar","exitCode":1,"message":error
            }}));
        });
        Ok(Self {
            inner,
            child: Mutex::new(child),
        })
    }
    pub async fn request(&self, channel: String, args: Vec<Value>) -> Result<Value, String> {
        if !channel.starts_with("pix:") {
            return Err("Invalid RPC channel".into());
        }
        let start = Instant::now();
        while !self.inner.ready.load(Ordering::Acquire) {
            if let Some(error) = self.inner.failure.lock().unwrap().clone() {
                return Err(error);
            }
            if start.elapsed() > Duration::from_secs(45) {
                return Err("Node Agent Sidecar startup timed out".into());
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let id = self.inner.next.fetch_add(1, Ordering::Relaxed).to_string();
        let (sender, receiver) = oneshot::channel();
        {
            let failure = self.inner.failure.lock().unwrap();
            if let Some(error) = failure.as_ref() {
                return Err(error.clone());
            }
            self.inner
                .pending
                .lock()
                .unwrap()
                .insert(id.clone(), sender);
        }
        if let Err(error) = self
            .inner
            .write(json!({"version":1,"kind":"request","id":id,"channel":channel,"args":args}))
        {
            self.inner.pending.lock().unwrap().remove(&id);
            return Err(error);
        }
        // Generation/interactive extensions can take a long time; abort is a separate concurrent RPC.
        let response = tokio::time::timeout(Duration::from_secs(24 * 60 * 60), receiver).await;
        self.inner.pending.lock().unwrap().remove(&id);
        response
            .map_err(|_| "Sidecar request timed out".to_owned())?
            .map_err(|_| "Sidecar disconnected".to_owned())?
    }
    pub fn shutdown(&self) {
        let _ = self.inner.write(json!({"version":1,"kind":"shutdown"}));
        if let Ok(mut child) = self.child.lock() {
            let start = Instant::now();
            while start.elapsed() < Duration::from_secs(5) {
                if child.try_wait().ok().flatten().is_some() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn node_command(
    binary: &Path,
    root: &Path,
    resources: &Path,
    data: &Path,
    documents: &Path,
    packaged: bool,
) -> Command {
    // Tauri canonicalizes Windows resource paths to \\?\C:\... . Node's main
    // module resolver fails on that form (EISDIR, lstat 'C:'). Simplify paths
    // at the process boundary, including paths the agent inherits through env.
    let root = dunce::simplified(root);
    let mut command = Command::new(dunce::simplified(binary));
    command
        .arg(root.join("dist").join("sidecar").join("sidecar.mjs"))
        .current_dir(root)
        .env("PIX_APP_ROOT", root)
        .env("PIX_RESOURCES_DIR", dunce::simplified(resources))
        .env("PIX_DATA_DIR", dunce::simplified(data))
        .env("PIX_DOCUMENTS_DIR", dunce::simplified(documents))
        .env("PIX_PACKAGED", if packaged { "1" } else { "0" })
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn starts_node_from_windows_canonical_paths() {
        let binary = PathBuf::from(std::env::var_os("PIX_SMOKE_NODE").expect("Set PIX_SMOKE_NODE"))
            .canonicalize()
            .unwrap();
        let fixture = std::env::temp_dir().join(format!("Pix 路径 test {}", std::process::id()));
        std::fs::create_dir_all(fixture.join("dist/sidecar")).unwrap();
        std::fs::write(
            fixture.join("dist/sidecar/sidecar.mjs"),
            r#"
                import assert from 'node:assert/strict';
                import { readFileSync } from 'node:fs';
                assert.ok(readFileSync(new URL(import.meta.url)).length > 0);
                for (const key of ['PIX_APP_ROOT', 'PIX_RESOURCES_DIR', 'PIX_DATA_DIR', 'PIX_DOCUMENTS_DIR']) {
                    assert.ok(!process.env[key].startsWith('\\\\?\\'), key);
                }
                assert.equal(process.env.PIX_PACKAGED, '1');
                console.log('ready');
            "#,
        )
        .unwrap();
        let root = fixture.canonicalize().unwrap();
        assert!(root.to_string_lossy().starts_with(r"\\?\"));
        let result = node_command(&binary, &root, &root, &root, &root, true).output();
        std::fs::remove_dir_all(&fixture).unwrap();
        let output = result.unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "ready");
    }
}
