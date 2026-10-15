import { useRegisterSW } from "virtual:pwa-register/react";

/** Never silently serve old code: when a new build is ready, offer it. */
export default function UpdateToast() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (reg) window.setInterval(() => void reg.update(), 30 * 60_000);
    },
  });
  if (!needRefresh) return null;
  return (
    <div className="toast" role="status">
      New version
      <button onClick={() => void updateServiceWorker(true)}>↻ Update</button>
    </div>
  );
}
