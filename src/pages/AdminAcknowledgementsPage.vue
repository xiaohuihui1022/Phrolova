<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef } from "vue";
import { Icon } from "@iconify/vue";
import AdminShell from "@/components/admin/AdminShell.vue";
import StatusBanner from "@/components/shared/StatusBanner.vue";
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
  { value: "dev", label: "开发人员" },
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
  avatar: "",
  sort_order: 0,
});

function resetAddForm() {
  addForm.player_id = "";
  addForm.category = "bug";
  addForm.description = "";
  addForm.avatar = "";
  addForm.sort_order = 0;
}

// ── Row-level editing ──
type EditableField = "player_id" | "category" | "description" | "avatar" | "sort_order";
const EDITABLE_FIELDS: Readonly<EditableField[]> = ["player_id", "category", "description", "avatar", "sort_order"];

interface RowDraft {
  player_id: string;
  category: string;
  description: string;
  avatar: string;
  sort_order: number;
}

const rowEditId = ref<number | null>(null);
const editDraft = reactive<Record<number, RowDraft>>({});
const editBackup = reactive<Record<number, RowDraft>>({});

function draftOf(row: AcknowledgementItem): RowDraft {
  return {
    player_id: row.player_id ?? "",
    category: row.category ?? "bug",
    description: row.description ?? "",
    avatar: row.avatar ?? "",
    sort_order: Number(row.sort_order) || 0,
  };
}

function startRowEdit(row: AcknowledgementItem) {
  if (rowEditId.value !== null && rowEditId.value !== row.id) cancelRowEdit();
  const draft = draftOf(row);
  editDraft[row.id] = { ...draft };
  editBackup[row.id] = { ...draft };
  rowEditId.value = row.id;
}

function cancelRowEdit() {
  const id = rowEditId.value;
  if (id !== null) {
    // 回滚：如果有备份就把备份数据恢复到 draft（也可以直接丢弃 draft）
    const backup = editBackup[id];
    const row = list.value.find(r => r.id === id);
    if (backup && row) {
      row.player_id = backup.player_id;
      row.category = backup.category;
      row.description = backup.description;
      row.avatar = backup.avatar;
      row.sort_order = backup.sort_order;
    }
    delete editDraft[id];
    delete editBackup[id];
  }
  rowEditId.value = null;
}

function rowDraftChanged(rowId: number): boolean {
  const d = editDraft[rowId];
  const b = editBackup[rowId];
  if (!d || !b) return false;
  return d.player_id.trim() !== b.player_id
    || d.category !== b.category
    || d.description.trim() !== b.description.trim()
    || d.avatar.trim() !== b.avatar.trim()
    || Number(d.sort_order) !== Number(b.sort_order);
}

async function commitRowEdit(row: AcknowledgementItem) {
  const id = row.id;
  const d = editDraft[id];
  if (!d) return;
  if (!d.player_id.trim()) {
    errorMsg.value = "玩家 ID 不能为空";
    return;
  }
  if (!rowDraftChanged(id)) {
    cancelRowEdit();
    return;
  }
  saving.value = true;
  errorMsg.value = "";
  try {
    // 字段白名单：仅提交允许更新的字段，并做类型收敛
    const payload: Partial<{
      player_id: string;
      category: string;
      description: string;
      avatar: string | null;
      sort_order: number;
    }> = {};
    const b = editBackup[id]!;
    if (d.player_id.trim() !== b.player_id) payload.player_id = d.player_id.trim();
    if (d.category !== b.category) payload.category = d.category;
    if (d.description.trim() !== b.description.trim()) payload.description = d.description.trim();
    if (d.avatar.trim() !== b.avatar.trim()) payload.avatar = d.avatar.trim() || null;
    if (Number(d.sort_order) !== Number(b.sort_order)) payload.sort_order = Number(d.sort_order) || 0;

    if (!Object.keys(payload).length) {
      cancelRowEdit();
      return;
    }
    await adminUpdateAcknowledgement(id, payload);
    // 后端更新成功后：以 draft 的已验证值回写本地列表，保证立即可见，随后全量刷新兜底
    const idx = list.value.findIndex(r => r.id === id);
    if (idx >= 0) {
      list.value[idx] = {
        ...list.value[idx],
        player_id: d.player_id.trim(),
        category: d.category,
        description: d.description.trim(),
        avatar: d.avatar.trim() || null,
        sort_order: Number(d.sort_order) || 0,
      };
    }
    delete editDraft[id];
    delete editBackup[id];
    rowEditId.value = null;
    // 兜底刷新（对齐排序、created_at 等后端可能调整的字段）
    loadList();
  } catch (err) {
    errorMsg.value = apiErrMsg(err) || "更新失败";
  } finally {
    saving.value = false;
  }
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
      avatar: addForm.avatar.trim() || null,
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
    if (rowEditId.value === row.id) {
      delete editDraft[row.id];
      delete editBackup[row.id];
      rowEditId.value = null;
    }
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
      <div class="ad-card-head">
        <div class="ad-card-head-left">
          <h2 class="ad-card-title"><Icon icon="ph:hand-heart-duotone" class="ad-card-icon" /> 致谢名单管理</h2>
          <p class="ad-card-desc">
            管理公开致谢名单，支持添加、整行编辑、删除。点击「编辑」或双击行进入编辑模式。
          </p>
        </div>
        <div class="ad-card-head-right">
          <button class="btn" :disabled="loading" @click="loadList">
            <Icon v-if="loading" icon="ph:spinner-gap-bold" class="ph-spin" />
            <Icon v-else icon="ph:arrows-clockwise-duotone" />
            {{ loading ? "加载中..." : "刷新" }}
          </button>
          <button class="btn btn-accent" :disabled="saving" @click="showAddForm = !showAddForm">
            <Icon :icon="showAddForm ? 'ph:minus-duotone' : 'ph:plus-duotone'" />
            {{ showAddForm ? "收起" : "新增条目" }}
          </button>
        </div>
      </div>
    </section>

    <!-- Add form -->
    <section class="ad-card" v-if="showAddForm">
      <div class="ad-card-head">
        <h3 class="ad-card-title"><Icon icon="ph:plus-circle-duotone" class="ad-card-icon" /> 新增致谢记录</h3>
      </div>
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
        <label class="ad-field ad-form-field--w100">
          <span class="ad-field-label">描述</span>
          <textarea v-model="addForm.description" class="form-input" rows="3" placeholder="贡献详情"></textarea>
        </label>
        <label class="ad-field ad-form-field--w100">
          <span class="ad-field-label">头像链接（可选，留空则显示首字母）</span>
          <input v-model="addForm.avatar" class="form-input" type="url" placeholder="https://example.com/avatar.png" />
        </label>
        <label class="ad-field">
          <span class="ad-field-label">排序 (sort_order)</span>
          <input v-model.number="addForm.sort_order" class="form-input" type="number" />
        </label>
      </div>
      <div class="ad-actions-right">
        <button class="btn-ghost btn-sm" :disabled="saving" @click="resetAddForm(); showAddForm = false">取消</button>
        <button class="btn btn-accent btn-sm" :disabled="saving || !addForm.player_id.trim()" @click="doAdd">
          <Icon v-if="saving" icon="ph:spinner-gap-bold" class="ph-spin" />
          {{ saving ? "提交中..." : "提交" }}
        </button>
      </div>
    </section>

    <!-- List -->
    <section class="ad-card">
      <div class="ad-list-head">
        <h3 class="ad-card-title"><Icon icon="ph:list-bullets-duotone" class="ad-card-icon" /> 全部记录 ({{ totalCount }})</h3>
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
              <th>头像链接</th>
              <th>排序</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in list"
              :key="row.id"
              :class="{ 'ad-row-sel': rowEditId === row.id }"
              @dblclick="rowEditId !== row.id && startRowEdit(row)"
            >
              <td>{{ row.id }}</td>
              <td>
                <input
                  v-if="rowEditId === row.id"
                  v-model="editDraft[row.id].player_id"
                  class="form-input"
                  type="text"
                  placeholder="玩家 ID"
                />
                <span v-else class="ad-cell-edit" @click.stop="startRowEdit(row)">{{ row.player_id }}</span>
              </td>
              <td>
                <select v-if="rowEditId === row.id" v-model="editDraft[row.id].category" class="form-input">
                  <option v-for="c in CATEGORY_OPTIONS" :key="c.value" :value="c.value">{{ c.label }}</option>
                </select>
                <span v-else class="ad-cell-edit" @click.stop="startRowEdit(row)">{{ categoryLabel(row.category) }}</span>
              </td>
              <td>
                <textarea
                  v-if="rowEditId === row.id"
                  v-model="editDraft[row.id].description"
                  class="form-input"
                  rows="2"
                  placeholder="贡献详情"
                ></textarea>
                <span
                  v-else
                  class="ad-cell-edit ad-cell-desc"
                  @click.stop="startRowEdit(row)"
                >{{ row.description || "—" }}</span>
              </td>
              <td>
                <input
                  v-if="rowEditId === row.id"
                  v-model="editDraft[row.id].avatar"
                  class="form-input"
                  type="url"
                  placeholder="留空则显示首字母"
                />
                <span
                  v-else
                  class="ad-cell-edit ad-cell-avatar"
                  :title="row.avatar || ''"
                  @click.stop="startRowEdit(row)"
                >{{ row.avatar || "—" }}</span>
              </td>
              <td>
                <input
                  v-if="rowEditId === row.id"
                  v-model.number="editDraft[row.id].sort_order"
                  class="form-input"
                  type="number"
                />
                <span v-else class="ad-cell-edit" @click.stop="startRowEdit(row)">{{ row.sort_order }}</span>
              </td>
              <td>{{ row.created_at ? new Date(row.created_at).toLocaleString() : '—' }}</td>
              <td class="ad-actions-col">
                <template v-if="rowEditId === row.id">
                  <button
                    class="btn btn-accent btn-sm"
                    :disabled="saving || !editDraft[row.id]?.player_id.trim()"
                    @click.stop="commitRowEdit(row)"
                  >
                    <Icon v-if="saving" icon="ph:spinner-gap-bold" class="ph-spin" />
                    <Icon v-else icon="ph:check-duotone" /> 保存
                  </button>
                  <button class="btn-ghost btn-sm" :disabled="saving" @click.stop="cancelRowEdit">
                    <Icon icon="ph:x-duotone" /> 取消
                  </button>
                </template>
                <template v-else>
                  <button class="btn-ghost btn-sm" :disabled="saving" @click.stop="startRowEdit(row)">
                    <Icon icon="ph:pencil-simple-duotone" /> 编辑
                  </button>
                  <button class="btn-ghost btn-sm danger" :disabled="saving" @click.stop="doDelete(row)">
                    <Icon icon="ph:trash-duotone" /> 删除
                  </button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else-if="!loading" class="ad-empty">
          <Icon icon="ph:tray-duotone" style="font-size: 1.6rem; opacity: 0.5;" />
          <p>暂无记录，点击「新增条目」开始添加。</p>
        </div>
        <div v-else class="ad-empty">
          <Icon icon="ph:spinner-gap-bold" class="ph-spin" style="font-size: 1.4rem;" />
          <p>加载中...</p>
        </div>
      </div>
    </section>
  </AdminShell>
</template>
