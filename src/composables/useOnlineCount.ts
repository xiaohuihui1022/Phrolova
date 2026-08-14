import { ref, onMounted, onBeforeUnmount } from "vue";
import { api } from "@/api/client";

const HEARTBEAT_MS = 20_000;
const POLL_MS = 10_000;

function getClientId(): string {
  const KEY = "phrolova_online_cid";
  try {
    let cid = sessionStorage.getItem(KEY);
    if (!cid) {
      cid = crypto.randomUUID();
      sessionStorage.setItem(KEY, cid);
    }
    return cid;
  } catch {
    return `anon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

type OnlineResp = { count: number; configured?: boolean };

export function useOnlineCount() {
  const onlineCount = ref(0);
  const onlineConnected = ref(false);

  let clientId = "";
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let disabled = false; // Upstash 未配置或异常 → 停掉轮询节省 Worker 调用

  async function heartbeat() {
    try {
      const data = await api.post<OnlineResp>("/online/heartbeat", {
        client_id: clientId,
      });
      onlineCount.value = data.count ?? 0;
      onlineConnected.value = !!data.configured;
      if (!data.configured) {
        disabled = true;
        stopTimers();
      }
    } catch {
      onlineConnected.value = false;
    }
  }

  async function pollCount() {
    try {
      const data = await api.get<OnlineResp>("/online/count");
      onlineCount.value = data.count ?? 0;
      onlineConnected.value = !!data.configured;
      if (!data.configured) {
        disabled = true;
        stopTimers();
      }
    } catch {
      onlineConnected.value = false;
    }
  }

  function handleVisibility() {
    if (disabled) return;
    if (document.hidden) {
      stopTimers();
    } else {
      heartbeat();
      startTimers();
    }
  }

  function handleUnload() {
    if (disabled) return;
    try {
      const blob = new Blob(
        [JSON.stringify({ client_id: clientId })],
        { type: "application/json" },
      );
      navigator.sendBeacon("/api/online/leave", blob);
    } catch {
      // ignore
    }
  }

  function startTimers() {
    if (disabled) return;
    stopTimers();
    heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
    pollTimer = setInterval(pollCount, POLL_MS);
  }

  function stopTimers() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  onMounted(() => {
    clientId = getClientId();
    pollCount();
    heartbeat();
    startTimers();
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handleUnload);
  });

  onBeforeUnmount(() => {
    stopTimers();
    document.removeEventListener("visibilitychange", handleVisibility);
    window.removeEventListener("pagehide", handleUnload);
  });

  return { onlineCount, onlineConnected };
}
