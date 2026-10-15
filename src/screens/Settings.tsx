import { supabase } from "../lib/supabase";
import { db } from "../lib/db";
import { DEFAULT_TZ } from "../lib/dayKey";

export default function Settings(props: { email: string; online: boolean }) {
  async function signOut() {
    await db.delete();          // clear the local copy on this device
    await supabase.auth.signOut();
    location.reload();
  }
  return (
    <>
      <header className="top"><div><div className="date">Settings</div><h1 className="sentence">⚙ Nest</h1></div></header>
      <div className="card">
        <div className="kv"><span>👤</span><span className="muted">{props.email}</span></div>
        <div className="kv"><span>🕓 Time zone</span><span className="muted">{DEFAULT_TZ}</span></div>
        <div className="kv"><span>📶</span><span className="muted">{props.online ? "Online" : "Offline"}</span></div>
        <div className="kv"><span>🏷 Version</span><span className="muted">{__BUILD__}</span></div>
      </div>
      <div className="stack" style={{ marginTop: 16 }}>
        <button className="btn" onClick={() => location.reload()}>↻ Check for update</button>
        <button className="btn" onClick={signOut}>⎋ Sign out</button>
      </div>
    </>
  );
}
