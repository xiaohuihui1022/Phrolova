<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef } from "vue";
import { Icon } from "@iconify/vue";
import AdminShell from "@/components/admin/AdminShell.vue";
import { useAdmin } from "@/composables/useAdmin";
import {
  adminFetchAcknowledgements,
  adminAddAcknowledgement,
  adminUpdateAcknowledgement,
  adminDeleteAcknowledgement,
  type AcknowledgementItem,
} from "@/api";
import { errMsg as apiErrMsg } from "@/api/client";

// 管理员 token 注入现在由 client.ts 请求拦截器统一处理（根据 hasAdminHint）
// useAdmin 仅用于登录态展示 / 登出
useAdmin();

const loading = ref(false);
const saving = ref(false);
const list = ref<AcknowledgementItem[]>([]);
const errorMsg = ref("");

const CATEGORY_OPTIONS = [
  { value: "bug", label: "Bug 反馈" },
  { value: "feature", label: "功能建议" },
  { value: "support", label: "技术支持" },
  { value: "other", label: "其他贡献" },
] as const;

function categoryLabel(v: string) {
  return CATEGORY_OPTIONS.find(c => c.value === v)?.label ?? v;
}

// ── Add form ──
const showAddForm = ref(false);
const addForm = reactive({
  player_id: "",
  category: "bug",
  description: "",
  sort_order: 0,
});

function resetAddForm() {
  addForm.player_id = "";
  addForm.category = "bug";
  addForm.description = "";
  addForm.sort_order = 0;
}

// ── Editing ──
interface EditingState {
  id: number;
  field: "player_id" | "category" | "description" | "sort_order";
  value: string;
}
const editing = ref<EditingState | null>(null);
let editInputEl: HTMLInputElement | HTMLSelectElement | null = null;

function startEdit(row: AcknowledgementItem, field: EditingState["field"]) {
  if (editing.value) cancelEdit();
  const curValue = field === "sort_order" ? String(row.sort_order ?? 0) : String(row[field] ?? "");
  editing.value = { id: row.id, field, value: curValue };
  setTimeout(() => editInputEl?.focus(), 0);
}

function cancelEdit() {
  editing.value = null;
}

async function commitEdit() {
  const e = editing.value;
  if (!e) return;
  saving.value = true;
  errorMsg.value = "";
  try {
    const payload: Record<string, unknown> = {};
    if (e.field === "sort_order") {
      payload.sort_order = Number(e.value) || 0;
    } else {
      payload[e.field] = e.value.trim();
    }
    // 过渡期：adminUpdateAcknowledgement 已改为直接用拦截器注入，不再传 headers
    await adminUpdateAcknowledgement(e.id, payload);
    await loadList();
    editing.value = null;
  } catch (err) {
    // 管理员 401 已由 client.ts 拦截器统一处理（清 token + 跳登录页），
    //   此处仅展示剩余业务错误即可
    errorMsg.value = apiErrMsg(err) || "更新失败";
  } finally {
    saving.value = false;
  }
}

function onEditKey(ev: KeyboardEvent) {
  if (ev.key === "Escape") cancelEdit();
  else if (ev.key === "Enter" && editing.value?.field !== "description") commitEdit();
}

// ── Actions ──
async function loadList() {
  loading.value = true;
  errorMsg.value = "";
  try {
    const data = await adminFetchAcknowledgements();
    list.value = data.list ?? [];
  } catch (err) {
    errorMsg.value = apiErrMsg(err) || "加载失败";
  } finally {
    loading.value = false;
  }
}

async function doAdd() {
  if (!addForm.player_id.trim()) {
    errorMsg.value = "请输入玩家ID";
    return;
  }
  saving.value = true;
  errorMsg.value = "";
  try {
    await adminAddAcknowledgement({
      player_id: addForm.player_id.trim(),
      category: addForm.category,
      description: addForm.description.trim(),
      sort_order: Number(addForm.sort_order) || 0,
    });
    resetAddForm();
    showAddForm.value = false;
    await loadList();
  } catch (err) {
    errorMsg.value = apiErrMsg(err) || "添加失败";
  } finally {
    saving.value = false;
  }
}

async function doDelete(row: AcknowledgementItem) {
  if (!confirm(`确认删除「${row.player_id}」的致谢记录？`)) return;
  saving.value = true;
  errorMsg.value = "";
  try {
    await adminDeleteAcknowledgement(row.id);
    await loadList();
  } catch (err) {
    errorMsg.value = apiErrMsg(err) || "删除失败";
  } finally {
    saving.value = false;
  }
}

const totalCount = computed(() => list.value.length);

onMounted(loadList);
</script>

<template>
  <AdminShell>
    <section class="ad-card">
      <h2 class="ad-card-title"><Icon icon="ph:hand-heart-duotone" class="ad-card-icon" /> 致谢名单管理</h2>
      <p class="ad-card-desc">
        管理公开致谢名单，支持添加、编辑、删除。类别：Bug 反馈 / 功能建议 / 技术支持 / 其他贡献。
        可通过 <strong>sort_order</strong> 控制显示顺序（数字小的靠前）。
      </p>
      <div class="ad-btn-row">
        <button class="btn" :disabled="loading" @click="loadList">
          <Icon v-if="loading" icon="ph:spinner-gap-bold" class="ph-spin" />
          {{ loading ? "加载中..." : "刷新列表" }}
        </button>
        <button class="btn btn-accent" :disabled="saving" @click="showAddForm = !showAddForm">
          <Icon icon="ph:plus-duotone" />
          {{ showAddForm ? "收起表单" : "新增条目" }}
        </button>
      </div>
    </section>

    <!-- Add form -->
    <section class="ad-card" v-if="showAddForm">
      <h3 class="ad-card-title"><Icon icon="ph:plus-circle-duotone" class="ad-card-icon" /> 新增致谢记录</h3>
      <div class="ad-form-grid">
        <label class="ad-field">
          <span class="ad-field-label">玩家 ID</span>
          <input v-model="addForm.player_id" class="form-input" type="text" placeholder="如：MoonCC" />
        </label>
        <label class="ad-field">
          <span class="ad-field-label">类别</span>
          <select v-model="addForm.category" class="form-input">
            <option v-for="c in CATEGORY_OPTIONS" :key="c.value" :value="c.value">{{ c.label }}</option>
          </select>
        </label>
        <label class="ad-field">
          <span class="ad-field-label">描述</span>
          <textarea v-model="addForm.description" class="form-input" rows="3" placeholder="贡献详情"></textarea>
        </label>
        <label class="ad-field">
          <span class="ad-field-label">排序 (sort_order)</span>
          <input v-model.number="addForm.sort_order" class="form-input" type="number" />
        </label>
      </div>
      <div class="ad-btn-row" style="margin-top: 16px; justify-content: flex-end;">
        <button class="btn-ghost" :disabled="saving" @click="resetAddForm(); showAddForm = false">取消</button>
        <button class="btn btn-accent" :disabled="saving || !addForm.player_id.trim()" @click="doAdd">
          <Icon v-if="saving" icon="ph:spinner-gap-bold" class="ph-spin" />
          {{ saving ? "提交中..." : "提交" }}
        </button>
      </div>
    </section>

    <!-- List -->
    <section class="ad-card">
      <div class="ad-list-head">
        <h3 class="ad-card-title" style="margin:0"><Icon icon="ph:list-bullets-duotone" class="ad-card-icon" /> 全部记录 ({{ totalCount }})</h3>
      </div>
      <StatusBanner v-if="errorMsg" :message="errorMsg" tone="error" style="margin-bottom: 12px;" />
      <div class="ad-list-table-wrap">
        <table class="ad-list-table" v-if="list.length">
          <thead>
            <tr>
              <th>ID</th>
              <th>玩家 ID</th>
              <th>类别</th>
              <th>描述</th>
              <th>排序</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in list" :key="row.id">
              <td>{{ row.id }}</td>
              <td>
                <template v-if="editing?.id === row.id && editing.field === 'player_id'">
                  <input ref="(el: any) => { if (el) editInputEl = el as any }" v-model="editing!.value"
                    class="form-input" @keydown="onEditKey" />
                </template>
                <template v-else>
                  <span class="ad-cell-edit" @dblclick="startEdit(row, 'player_id')">{{ row.player_id }}</span>
                </template>
              </td>
              <td>
                <template v-if="editing?.id === row.id && editing.field === 'category'">
                  <select ref="(el: any) => { if (el) editInputEl = el as any }" v-model="editing!.value"
                    class="form-input" @keydown="onEditKey">
                    <option v-for="c in CATEGORY_OPTIONS" :key="c.value" :value="c.value">{{ c.label }}</option>
                  </select>
                </template>
                <template v-else>
                  <span class="ad-cell-edit" @dblclick="startEdit(row, 'category')">{{ categoryLabel(row.category) }}</span>
                </template>
              </td>
              <td>
                <template v-if="editing?.id === row.id && editing.field === 'description'">
                  <textarea ref="(el: any) => { if (el) editInputEl = el as any }" v-model="editing!.value"
                    class="form-input" rows="2" @keydown="onEditKey"></textarea>
                </template>
                <template v-else>
                  <span class="ad-cell-edit ad-cell-desc" @dblclick="startEdit(row, 'description')">{{ row.description }}</span>
                </template>
              </td>
              <td>
                <template v-if="editing?.id === row.id && editing.field === 'sort_order'">
                  <input ref="(el: any) => { if (el) editInputEl = el as any }" v-model="editing!.value"
                    type="number" class="form-input" @keydown="onEditKey" />
                </template>
                <template v-else>
                  <span class="ad-cell-edit" @dblclick="startEdit(row, 'sort_order')">{{ row.sort_order }}</span>
                </template>
              </td>
              <td>{{ row.created_at ? new Date(row.created_at).toLocaleString() : '—' }}</td>
              <td class="ad-actions-col">
                <template v-if="editing?.id === row.id">
                  <button class="btn btn-accent btn-sm" :disabled="saving" @click="commitEdit">
                    <Icon v-if="saving" icon="ph:spinner-gap-bold" class="ph-spin" />
                    保存
                  </button>
                  <button class="btn-ghost btn-sm" @click="cancelEdit">取消</button>
                </template>
                <template v-else>
                  <button class="btn-ghost btn-sm danger" :disabled="saving" @click="doDelete(row)">删除</button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else-if="!loading" class="ad-empty">暂无记录，点击「新增条目」开始添加。</div>
        <div v-else class="ad-empty">加载中...</div>
      </div>
    </section>
  </AdminShell>
</template>
