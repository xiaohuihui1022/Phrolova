<script setup lang="ts">
import { onBeforeUnmount, reactive, ref } from "vue";
import { Icon } from "@iconify/vue";
import Pagination from "@/components/shared/Pagination.vue";
import AdminShell from "@/components/admin/AdminShell.vue";
import { useAdmin, handleAdminApiError } from "@/composables/useAdmin";
import { apiPath, requestJson } from "@/api/http";
import {
  ADMIN_PAGE_SIZE,
  DIFF_FIELDS,
  SYNC_POLL_INTERVAL,
  SYNC_POLL_MAX,
  fieldLabel,
  tableTitle,
  type AdminRecordKind,
} from "@/composables/adminConstants";

const { adminHeaders } = useAdmin();

const syncing = ref(false);
const syncResult = ref<Record<string, unknown> | null>(null);
const syncError = ref("");
const syncElapsed = ref(0);
const preview = ref<Record<string, unknown> | null>(null);

interface DiffResult {
  ok?: boolean;
  total_remote?: number;
  total_local?: number;
  new?: Array<{ name: string; [key: string]: unknown }>;
  changed?: Array<{ name: string; before: Record<string, unknown>; after: Record<string, unknown> }>;
  unchanged?: number;
}
const diffActions = ref(new Map<string, Set<string>>());
const diffPages = reactive<Record<string, number>>({});

let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollCount = 0;

function diffPageOf(key: string) { return diffPages[key] || 1; }
function setDiffPage(key: string, p: number) { diffPages[key] = p; }
function pagedDiff(arr: any[], key: string) {
  const p = diffPageOf(key);
  return arr.slice((p - 1) * ADMIN_PAGE_SIZE, p * ADMIN_PAGE_SIZE);
}

function setRemote(name: string) {
  diffActions.value.set(name, new Set());
  diffActions.value = new Map(diffActions.value);
}
function setLocal(name: string) {
  diffActions.value.delete(name);
  diffActions.value = new Map(diffActions.value);
}
function toggleDiffField(name: string, field: string) {
  if (!diffActions.value.has(name)) diffActions.value.set(name, new Set());
  const s = diffActions.value.get(name)!;
  if (s.has(field)) s.delete(field); else s.add(field);
  if (s.size === 0) diffActions.value.delete(name);
  diffActions.value = new Map(diffActions.value);
}
function diffAction(name: string): "none" | "remote" | "partial" {
  const s = diffActions.value.get(name);
  if (!s) return "none";
  return s.size === 0 ? "remote" : "partial";
}
function isDiffFieldOn(name: string, field: string): boolean {
  const s = diffActions.value.get(name);
  return s ? (s.size === 0 || s.has(field)) : false;
}

function diffRows(r: any): any[] {
  const rows: any[] = [];
  for (const item of (r.new || [])) rows.push({ ...item, _kind: "new" });
  for (const item of (r.changed || [])) {
    rows.push({ name: item.name, _kind: "changed", before: item.before, after: item.after });
  }
  return rows;
}

async function loadPreview() {
  syncing.value = true;
  syncError.value = "";
  syncResult.value = null;
  preview.value = null;
  diffActions.value = new Map();
  try {
    const data = await requestJson<{ status: string; result: Record<string, unknown> }>(
      apiPath("/admin/sync/preview"),
      { method: "POST", headers: adminHeaders(), body: JSON.stringify({ type: "all" }) },
    );
    preview.value = data.result;
  } catch (e) {
    if (!handleAdminApiError(e)) {
      syncError.value = e instanceof Error ? e.message : "预览失败";
    }
  } finally {
    syncing.value = false;
  }
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollOnce() {
  try {
    const s = await requestJson<{ status: string; result: Record<string, unknown> | null }>(
      apiPath("/admin/sync/status"),
      { headers: adminHeaders() },
    );
    if (s.status === "idle") {
      stopPolling();
      syncResult.value = s.result;
      preview.value = null;
      syncing.value = false;
    }
  } catch (e) {
    stopPolling();
    syncing.value = false;
    if (!handleAdminApiError(e)) {
      syncError.value = e instanceof Error ? e.message : "同步状态查询失败";
    }
  }
}

async function triggerSync() {
  syncing.value = true;
  syncError.value = "";
  syncResult.value = null;
  syncElapsed.value = 0;

  try {
    const entries = diffActions.value.size > 0
      ? [...diffActions.value.entries()].map(([name, fields]) => ({ name, fields: fields.size > 0 ? [...fields] : undefined }))
      : undefined;

    const start = await requestJson<{ status: string; message: string }>(
      apiPath("/admin/sync"),
      { method: "POST", headers: adminHeaders(), body: JSON.stringify({ type: "all", entries }) },
    );

    if (start.status !== "started") {
      syncing.value = false;
      syncError.value = start.message || "启动失败";
      return;
    }

    pollCount = 0;
    stopPolling();
    pollTimer = setInterval(async () => {
      pollCount++;
      syncElapsed.value = pollCount * SYNC_POLL_INTERVAL;
      if (pollCount >= SYNC_POLL_MAX) {
        stopPolling();
        syncing.value = false;
        syncError.value = "同步超时，请稍后到日志查看结果";
        return;
      }
      await pollOnce();
    }, SYNC_POLL_INTERVAL);
  } catch (e) {
    syncing.value = false;
    if (!handleAdminApiError(e)) {
      syncError.value = e instanceof Error ? e.message : "同步请求失败";
    }
  }
}

onBeforeUnmount(() => stopPolling());
</script>

<template>
  <AdminShell>
    <section class="ad-card">
      <div class="ad-card-head">
        <div class="ad-card-head-left">
          <h2 class="ad-card-title"><Icon icon="ph:git-diff-duotone" class="ad-card-icon" /> 对比 &amp; 同步</h2>
          <p class="ad-card-desc">拉取远程数据与本地对比，选择差异条目同步到数据库</p>
        </div>
        <div class="ad-card-head-right">
          <button class="btn" :disabled="syncing" @click="loadPreview">
            <Icon v-if="syncing" icon="ph:spinner-gap-bold" class="ph-spin" />
            <Icon v-else icon="ph:magnifying-glass-duotone" />
            {{ syncing ? "对比中..." : "对比差异" }}
          </button>
          <button v-if="preview" class="btn-ghost btn-sm" :disabled="syncing" @click="preview = null; syncResult = null; syncError = ''">
            <Icon icon="ph:x-duotone" /> 清除
          </button>
        </div>
      </div>
      <div v-if="syncError" class="ad-error">{{ syncError }}</div>
    </section>

    <template v-if="preview">
      <template v-for="(r, key) in { characters: preview.characters, echoes: preview.echoes }" :key="key">
        <section v-if="(r as DiffResult)?.ok" class="ad-card">
          <div class="ad-card-head">
            <h3 class="ad-card-title">{{ tableTitle(key as AdminRecordKind) }} <span class="ad-count-pill">远程 {{ (r as DiffResult).total_remote }} · 本地 {{ (r as DiffResult).total_local }}</span></h3>
          </div>
          <div class="ad-stat-row">
            <span class="ad-stat-pill ad-stat-pill--new"><Icon icon="ph:plus-duotone" /> 新增{{ (r as DiffResult).new?.length || 0 }}</span>
            <span class="ad-stat-pill ad-stat-pill--changed"><Icon icon="ph:pencil-simple-duotone" /> 变更{{ (r as DiffResult).changed?.length || 0 }}</span>
            <span class="ad-stat-pill"><Icon icon="ph:check-duotone" /> 未变{{ (r as DiffResult).unchanged }}</span>
          </div>
          <div v-if="!(r as DiffResult).new?.length && !(r as DiffResult).changed?.length" class="ad-no-diff"><Icon icon="ph:check-circle-duotone" /> 已是最新</div>
          <template v-if="(r as DiffResult).new?.length || (r as DiffResult).changed?.length">
            <div class="ad-table-wrap">
              <table class="ad-table"><thead><tr>
                <th class="ad-th-sel">同步</th><th>名称</th><th>类型</th>
                <th v-for="f in DIFF_FIELDS[key as AdminRecordKind]" :key="f">{{ fieldLabel(f) }}</th>
              </tr></thead><tbody>
                <tr v-for="item in pagedDiff(diffRows(r as any), key as string)" :key="item.name"
                  :class="{ 'ad-row-new': item._kind === 'new', 'ad-row-changed': item._kind === 'changed', 'ad-row-sel': diffAction(item.name) !== 'none' }">
                  <td class="ad-td-sel">
                    <div class="ad-act-group">
                      <button class="ad-act-btn" :class="{ 'ad-act-btn--remote': diffAction(item.name) === 'remote', 'ad-act-btn--partial': diffAction(item.name) === 'partial' }"
                        @click.stop="diffAction(item.name) === 'none' ? setRemote(item.name) : setLocal(item.name)"
                        :title="diffAction(item.name) === 'none' ? '点击同步远程' : '点击保留本地'">
                        {{ diffAction(item.name) === 'remote' ? "远程" : diffAction(item.name) === "partial" ? "部分" : "本地" }}
                      </button>
                    </div>
                  </td>
                  <td class="ad-td-name">{{ item.name }}</td>
                  <td class="ad-td-kind"><span :class="item._kind === 'new' ? 'ad-kind-tag--new' : 'ad-kind-tag--changed'">{{ item._kind === 'new' ? "新增" : "变更" }}</span></td>
                  <td v-for="f in DIFF_FIELDS[key as AdminRecordKind]" :key="f" class="ad-td-val"
                    :class="{ 'ad-td-diff': item._kind === 'changed' && String(item.before?.[f]) !== String(item.after?.[f]), 'ad-td-edited': isDiffFieldOn(item.name, f) }"
                    @click.stop="item._kind === 'changed' && diffAction(item.name) !== 'none' ? toggleDiffField(item.name, f) : null">
                    <template v-if="item._kind === 'changed' && String(item.before?.[f]) !== String(item.after?.[f])">
                      <div class="ad-val-compact"><span class="ad-val-old">{{ item.before[f] }}</span><span class="ad-val-arr">→</span><span class="ad-val-new" :class="{ 'ad-val-edited': isDiffFieldOn(item.name, f) }">{{ item.after[f] }}</span></div>
                    </template>
                    <template v-else>{{ (item as any)[f] ?? "-" }}</template>
                  </td>
                </tr>
              </tbody></table>
            </div>
            <Pagination v-if="diffRows(r).length > ADMIN_PAGE_SIZE" :current="diffPageOf(key as string)" :total="diffRows(r).length" :size="ADMIN_PAGE_SIZE" @change="setDiffPage(key as string, $event)" />
          </template>
        </section>
      </template>
      <section class="ad-card">
        <div class="ad-btn-row">
          <button class="btn" :disabled="syncing || !diffActions.size" @click="triggerSync">
            <Icon v-if="syncing" icon="ph:spinner-gap-bold" class="ph-spin" />
            <Icon v-else icon="ph:cloud-arrow-down-duotone" />
            {{ syncing ? `同步中... (${Math.round(syncElapsed / 1000)}s)` : `应用${diffActions.size ? `${diffActions.size}项` : "全部"}` }}
          </button>
          <button v-if="diffActions.size" class="btn-ghost btn-sm" @click="diffActions = new Map()">
            <Icon icon="ph:arrow-u-up-left-duotone" /> 全部保留本地
          </button>
        </div>
      </section>
    </template>

    <template v-if="syncResult">
      <section class="ad-card">
        <h2 class="ad-card-title"><Icon icon="ph:flag-checkered-duotone" class="ad-card-icon" /> 同步结果</h2>
        <template v-if="syncResult.ok === false">
          <div class="ad-error"><Icon icon="ph:warning-duotone" /> {{ syncResult.message }}</div>
        </template>
        <template v-else>
          <div class="ad-no-diff"><Icon icon="ph:check-circle-duotone" /> 同步完成</div>
        </template>
      </section>
    </template>
  </AdminShell>
</template>
