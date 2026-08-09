<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { Icon } from "@iconify/vue";
import Pagination from "@/components/shared/Pagination.vue";
import AdminShell from "@/components/admin/AdminShell.vue";
import { useAdmin, handleAdminApiError } from "@/composables/useAdmin";
import { apiPath, requestJson } from "@/api/http";
import {
  ADMIN_PAGE_SIZE,
  TABLE_FIELDS,
  fieldLabel,
  tableTitle,
  type AdminRecordKind,
} from "@/composables/adminConstants";

const { adminHeaders } = useAdmin();

const loadingLocal = ref(false);
const syncing = ref(false);
const syncError = ref("");
const localData = ref<Record<string, any[]> | null>(null);
const tableRowsSelected = ref(new Set<string>());
const tableEdits = ref(new Map<string, string>());
const tablePages = reactive<Record<string, number>>({ characters: 1, echoes: 1 });

interface EditingState {
  kind: AdminRecordKind;
  name: string;
  field: string;
  value: string;
}
const editing = ref<EditingState | null>(null);
let editInputEl: HTMLInputElement | HTMLSelectElement | null = null;

function tablePageOf(k: string) { return tablePages[k] || 1; }
function setTablePage(k: string, p: number) { tablePages[k] = p; }
function isTableSelected(n: string) { return tableRowsSelected.value.has(n); }

function toggleTableRow(name: string) {
  if (tableRowsSelected.value.has(name)) tableRowsSelected.value.delete(name);
  else tableRowsSelected.value.add(name);
  tableRowsSelected.value = new Set(tableRowsSelected.value);
}

function getTableEdit(name: string, field: string, fallback: string): string {
  return tableEdits.value.get(`${name}|${field}`) ?? fallback;
}

function isEdited(name: string, field: string): boolean {
  return tableEdits.value.has(`${name}|${field}`);
}

function editInputType(field: string): "number" | "checkbox" | "text" | "select" {
  if (field === "star_rating" || field === "cost") return "number";
  if (field === "is_aberration") return "select";
  return "text";
}

function editNumberMinMax(field: string): { min?: number; max?: number } {
  if (field === "star_rating") return { min: 1, max: 6 };
  if (field === "cost") return { min: 0, max: 9 };
  return {};
}

function startEdit(kind: AdminRecordKind, name: string, field: string, cur: string) {
  if (editing.value) commitEdit();
  editing.value = { kind, name, field, value: cur };
  setTimeout(() => editInputEl?.focus(), 0);
}

function cancelEdit() {
  editing.value = null;
}

function commitEdit() {
  const e = editing.value;
  if (!e) return;
  const { name, field, value } = e;
  const oldValue = tableEdits.value.get(`${name}|${field}`);
  const map = new Map(tableEdits.value);
  if (value !== oldValue) {
    map.set(`${name}|${field}`, value);
    if (!tableRowsSelected.value.has(name)) {
      tableRowsSelected.value.add(name);
      tableRowsSelected.value = new Set(tableRowsSelected.value);
    }
  }
  tableEdits.value = map;
  editing.value = null;
}

function onEditKey(e: KeyboardEvent) {
  if (e.key === "Escape") cancelEdit();
  else if (e.key === "Enter") commitEdit();
}

async function loadLocalData() {
  loadingLocal.value = true;
  localData.value = null;
  try {
    const d = await requestJson<{ status: string; data: Record<string, any[]> }>(
      apiPath("/admin/data"),
      { headers: adminHeaders() },
    );
    localData.value = d.data;
  } catch (e) {
    if (!handleAdminApiError(e)) {
      syncError.value = e instanceof Error ? e.message : "加载失败";
    }
  } finally {
    loadingLocal.value = false;
  }
}

async function syncTable() {
  const entries: { name: string; overwrites: Record<string, string> }[] = [];
  for (const name of tableRowsSelected.value) {
    const ov: Record<string, string> = {};
    for (const [key, val] of tableEdits.value.entries()) {
      const idx = key.indexOf("|");
      if (idx === -1) continue;
      const n = key.slice(0, idx), f = key.slice(idx + 1);
      if (n === name) ov[f] = val;
    }
    if (Object.keys(ov).length > 0) entries.push({ name, overwrites: ov });
  }
  if (!entries.length) {
    syncError.value = "请先编辑单元格";
    return;
  }
  syncing.value = true;
  syncError.value = "";
  try {
    const result = await requestJson<{ status: string; updated: number; message?: string }>(
      apiPath("/admin/update"),
      { method: "POST", headers: adminHeaders(), body: JSON.stringify({ entries }) },
    );
    if (result.status === "success") {
      tableRowsSelected.value = new Set();
      tableEdits.value = new Map();
      syncError.value = "";
      await loadLocalData();
    } else {
      syncError.value = result.message || "更新失败";
    }
  } catch (e) {
    if (!handleAdminApiError(e)) {
      syncError.value = e instanceof Error ? e.message : "更新失败";
    }
  } finally {
    syncing.value = false;
  }
}

function clearAll() {
  tableRowsSelected.value = new Set();
  tableEdits.value = new Map();
  editing.value = null;
}

const totalEdited = computed(() => tableEdits.value.size);
</script>

<template>
  <AdminShell>
    <section class="ad-card">
      <h2 class="ad-card-title"><Icon icon="ph:table-duotone" class="ad-card-icon" /> 数据表格</h2>
      <p class="ad-card-desc">查看和编辑本地数据库中的所有数据，点击单元格直接编辑，选中行后同步修改</p>
      <div class="ad-btn-row">
        <button class="btn" :disabled="loadingLocal" @click="loadLocalData">
          <Icon v-if="loadingLocal" icon="ph:spinner-gap-bold" class="ph-spin" />
          {{ loadingLocal ? "加载中..." : "加载数据" }}
        </button>
      </div>
    </section>

    <template v-if="localData">
      <template v-for="kind in (['characters', 'echoes'] as const)" :key="kind">
        <section v-if="localData[kind]?.length" class="ad-card">
          <h3 class="ad-card-title">{{ tableTitle(kind) }} — {{ localData[kind].length }} 条</h3>
          <div class="ad-table-wrap">
            <table class="ad-table"><thead><tr>
              <th class="ad-th-sel">同步</th><th>名称</th>
              <th v-for="f in TABLE_FIELDS[kind]" :key="f">{{ fieldLabel(f) }}</th>
            </tr></thead><tbody>
              <tr v-for="row in localData[kind].slice((tablePageOf(kind) - 1) * ADMIN_PAGE_SIZE, tablePageOf(kind) * ADMIN_PAGE_SIZE)" :key="row.name"
                :class="{ 'ad-row-sel': isTableSelected(row.name) }" @click="toggleTableRow(row.name)">
                <td class="ad-td-sel"><div class="ad-sel-dot" :class="{ 'ad-sel-dot--on': isTableSelected(row.name) }" /></td>
                <td class="ad-td-name">{{ row.name }}</td>
                <td v-for="f in TABLE_FIELDS[kind]" :key="f" class="ad-td-val"
                  :class="{ 'ad-td-edited': isEdited(row.name, f), 'ad-td-editing': editing?.kind === kind && editing?.name === row.name && editing?.field === f }"
                  @click.stop="!editing ? startEdit(kind, row.name, f, getTableEdit(row.name, f, String(row[f] ?? ''))) : null">
                  <!-- 编辑模式 -->
                  <template v-if="editing?.kind === kind && editing?.name === row.name && editing?.field === f">
                    <input
                      v-if="editInputType(f) !== 'select'"
                      :ref="(el: any) => { editInputEl = el; }"
                      :type="editInputType(f)"
                      :value="editing?.value"
                      v-bind="editNumberMinMax(f)"
                      class="ad-edit-input"
                      @input="(e: Event) => { editing!.value = (e.target as HTMLInputElement).value; }"
                      @blur="commitEdit"
                      @keydown="onEditKey"
                      @click.stop
                    />
                    <select
                      v-else
                      :ref="(el: any) => { editInputEl = el; }"
                      class="ad-edit-input"
                      :value="editing?.value"
                      @change="(e: Event) => { editing!.value = (e.target as HTMLSelectElement).value; commitEdit(); }"
                      @click.stop
                    >
                      <option value="false">否</option>
                      <option value="true">是</option>
                    </select>
                  </template>
                  <!-- 显示模式 -->
                  <template v-else>
                    <span :class="{ 'ad-val-edited': isEdited(row.name, f) }">
                      {{ getTableEdit(row.name, f, row[f] === true ? "是" : row[f] === false ? "否" : String(row[f] ?? "-")) }}
                    </span>
                  </template>
                </td>
              </tr>
            </tbody></table>
          </div>
          <Pagination v-if="localData[kind].length > ADMIN_PAGE_SIZE" :current="tablePageOf(kind)" :total="localData[kind].length" :size="ADMIN_PAGE_SIZE" @change="setTablePage(kind, $event)" />
        </section>
      </template>

      <section class="ad-card">
        <div v-if="syncError" class="ad-error">{{ syncError }}</div>
        <div class="ad-btn-row">
          <button class="btn" :disabled="syncing || !tableRowsSelected.size || !totalEdited" @click="syncTable">
            {{ syncing ? "同步中..." : `同步修改(${tableRowsSelected.size}项 · ${totalEdited}处编辑)` }}
          </button>
          <button v-if="tableRowsSelected.size || totalEdited" class="btn-ghost" @click="clearAll">取消全部</button>
        </div>
      </section>
    </template>
  </AdminShell>
</template>
