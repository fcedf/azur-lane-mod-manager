<template>
  <div class="tags-page">
    <div class="page-head">
      <div class="head-title">
        <el-icon :size="22" color="#409eff"><CollectionTag /></el-icon>
        <h2>标签管理</h2>
        <el-tag type="info" effect="plain" round>共 {{ tags.length }} 个标签</el-tag>
      </div>
      <div class="head-actions">
        <el-input
          v-model="keyword"
          placeholder="搜索标签名"
          clearable
          style="width: 200px"
          :prefix-icon="Search"
        />
        <el-button type="primary" :icon="Plus" @click="openCreate(null)">新建顶级标签</el-button>
        <el-button
          type="warning"
          plain
          :icon="Connection"
          :disabled="selected.length < 2"
          @click="openMerge"
        >
          合并{{ selected.length >= 2 ? `（${selected.length}）` : '' }}
        </el-button>
      </div>
    </div>

    <el-alert
      class="tip"
      type="info"
      :closable="false"
      show-icon
      title="支持父子层级：在标签上点「加子标签」建立下级；点父标签会聚合显示其下所有子标签的文件。删除父标签时子标签自动上移，文件不会被删除。"
    />

    <el-table
      ref="tableRef"
      :data="visibleTree"
      v-loading="loading"
      row-key="id"
      border
      default-expand-all
      :tree-props="{ children: 'children' }"
      :row-class-name="rowClassName"
      class="tag-table"
      @selection-change="onSelectionChange"
      @row-dblclick="row => openEdit(row)"
    >
      <el-table-column type="selection" width="46" reserve-selection />
      <el-table-column label="标签" min-width="260">
        <template #default="{ row }">
          <div class="name-cell">
            <el-tag
              class="tag-pill"
              :style="{ background: row.color + '22', borderColor: row.color, color: row.color }"
              effect="plain"
            >
              <el-icon style="margin-right: 2px"><PriceTag /></el-icon>{{ row.name }}
            </el-tag>
            <el-color-picker
              :model-value="row.color"
              :show-alpha="false"
              size="small"
              @change="c => quickColor(row, c)"
            />
          </div>
        </template>
      </el-table-column>
      <el-table-column label="文件数" width="170">
        <template #default="{ row }">
          <el-button link type="primary" @click="viewFiles(row)">
            {{ row.fileCount }} 个
          </el-button>
          <span v-if="row.children?.length" class="own-hint">（直接 {{ row.ownCount }}）</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="300">
        <template #default="{ row }">
          <el-button link type="success" @click="openCreate(row)">加子标签</el-button>
          <el-button link type="primary" @click="openMove(row)">移动</el-button>
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty description="没有匹配的标签" :image-size="80" />
      </template>
    </el-table>

    <!-- 新建 / 编辑标签 -->
    <el-dialog v-model="formVisible" :title="formTitle" width="460px">
      <el-form label-width="80px">
        <el-form-item v-if="form.parentName" label="所属父级">
          <el-tag type="info" effect="plain">{{ form.parentName }}</el-tag>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="标签名称" maxlength="30" show-word-limit />
        </el-form-item>
        <el-form-item label="颜色">
          <div class="color-row">
            <el-color-picker v-model="form.color" :show-alpha="false" />
            <div class="swatches">
              <span
                v-for="c in PRESET_COLORS"
                :key="c"
                class="swatch"
                :class="{ on: form.color?.toLowerCase() === c }"
                :style="{ background: c }"
                @click="form.color = c"
              />
            </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>

    <!-- 移动层级 -->
    <el-dialog v-model="moveVisible" title="移动标签到…" width="420px">
      <el-form label-width="80px">
        <el-form-item label="标签">
          <el-tag :style="{ background: moveRow?.color + '22', borderColor: moveRow?.color, color: moveRow?.color }" effect="plain">
            {{ moveRow?.name }}
          </el-tag>
        </el-form-item>
        <el-form-item label="新父级">
          <el-tree-select
            v-model="moveTargetId"
            :data="moveTreeData"
            :props="{ label: 'name', value: 'id', children: 'children' }"
            check-strictly
            clearable
            filterable
            placeholder="顶级（不选父级）"
            style="width: 100%"
          />
        </el-form-item>
      </el-form>
      <el-alert type="info" :closable="false" show-icon title="不能移动到它自己的子标签下面；移动后点父标签仍会聚合其文件。" />
      <template #footer>
        <el-button @click="moveVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitMove">确定</el-button>
      </template>
    </el-dialog>

    <!-- 合并标签 -->
    <el-dialog v-model="mergeVisible" title="合并标签" width="520px">
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 14px"
        title="所选标签下的文件会被归并到同一个目标标签（自动去重），被合并的源标签将被删除，其子标签会挂到目标下。"
      />
      <el-form label-width="92px">
        <el-form-item label="合并以下">
          <el-tag v-for="t in selected" :key="t.id" class="merge-tag" :style="{ background: t.color + '22', borderColor: t.color, color: t.color }">
            {{ t.name }}（{{ t.fileCount }}）
          </el-tag>
        </el-form-item>
        <el-form-item label="合并到">
          <el-radio-group v-model="merge.mode">
            <el-radio value="existing">已有标签</el-radio>
            <el-radio value="new">新建标签</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="merge.mode === 'existing'" label="目标标签">
          <el-select v-model="merge.targetId" placeholder="选择一个标签" style="width: 100%">
            <el-option
              v-for="t in mergeableExisting"
              :key="t.id"
              :value="t.id"
              :label="`${t.name}（${t.fileCount} 个文件）`"
            />
          </el-select>
        </el-form-item>
        <template v-else>
          <el-form-item label="新标签名" required>
            <el-input v-model="merge.targetName" placeholder="合并后的标签名称" maxlength="30" />
          </el-form-item>
        </template>
        <el-form-item label="目标颜色">
          <div class="color-row">
            <el-color-picker v-model="merge.targetColor" :show-alpha="false" />
            <div class="swatches">
              <span
                v-for="c in PRESET_COLORS"
                :key="c"
                class="swatch"
                :class="{ on: merge.targetColor?.toLowerCase() === c }"
                :style="{ background: c }"
                @click="merge.targetColor = c"
              />
            </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="mergeVisible = false">取消</el-button>
        <el-button type="warning" :loading="merging" @click="submitMerge">确认合并</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Search, Plus, Connection, PriceTag } from '@element-plus/icons-vue';
import {
  getTagTree, createTag, updateTag, deleteTag, mergeTags, setTagParent,
} from '../api/tag.js';

const router = useRouter();

const PRESET_COLORS = [
  '#409eff', '#67c23a', '#e6a23c', '#f56c6c',
  '#909399', '#9b59b6', '#1abc9c', '#e672c9',
  '#34495e', '#16a085', '#d35400', '#2980b9',
];

const loading = ref(false);
const tags = ref([]); // 后端返回的标签树
const keyword = ref('');

const depthMap = ref(new Map());

async function load() {
  loading.value = true;
  try {
    tags.value = await getTagTree();
    const dm = new Map();
    const walk = (nodes, d) => {
      for (const n of nodes) {
        dm.set(n.id, d);
        if (n.children?.length) walk(n.children, d + 1);
      }
    };
    walk(tags.value, 0);
    depthMap.value = dm;
  } finally {
    loading.value = false;
  }
}

function rowClassName({ row }) {
  const d = depthMap.value.get(row.id) ?? 0;
  return `tag-depth-${d}`;
}

/** 扁平化树（带父链），便于搜索/选择 */
const flatList = computed(() => {
  const out = [];
  const walk = (nodes, parent = null) => {
    for (const n of nodes) {
      out.push({ ...n, parentName: parent?.name || null, parentId: parent?.id ?? null });
      if (n.children?.length) walk(n.children, n);
    }
  };
  walk(tags.value);
  return out;
});

/** 搜索时：命中节点及其祖先都保留 */
const visibleTree = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return tags.value;
  const keep = new Set();
  const mark = (node) => {
    keep.add(node.id);
  };
  // 找到命中节点，沿 parent 无法直接拿，先建 id->node + parent map
  const byId = new Map();
  const parentOf = new Map();
  const index = (nodes, p = null) => {
    for (const n of nodes) {
      byId.set(n.id, n);
      if (p) parentOf.set(n.id, p.id);
      index(n.children || [], n);
    }
  };
  index(tags.value);
  for (const n of byId.values()) {
    if (n.name.toLowerCase().includes(kw)) {
      let cur = n;
      while (cur) { mark(cur.id); cur = parentOf.has(cur.id) ? byId.get(parentOf.get(cur.id)) : null; }
    }
  }
  const prune = (nodes) =>
    nodes.filter((n) => keep.has(n.id)).map((n) => ({
      ...n,
      children: n.children?.length ? prune(n.children) : [],
    }));
  return prune(tags.value);
});

/* ---------- 新建 / 编辑 ---------- */
const formVisible = ref(false);
const saving = ref(false);
const form = reactive({ id: null, name: '', color: '#409eff', parentId: null, parentName: '' });

const formTitle = computed(() => {
  if (form.id) return '编辑标签';
  return form.parentName ? `在「${form.parentName}」下新建子标签` : '新建顶级标签';
});

function openCreate(parentRow) {
  form.id = null;
  form.name = '';
  form.color = parentRow ? parentRow.color : PRESET_COLORS[0];
  form.parentId = parentRow ? parentRow.id : null;
  form.parentName = parentRow ? parentRow.name : '';
  formVisible.value = true;
}
function openEdit(row) {
  const flat = flatList.value.find((t) => t.id === row.id);
  form.id = row.id;
  form.name = row.name;
  form.color = row.color;
  form.parentId = row.parentId ?? null;
  form.parentName = flat?.parentName || '';
  formVisible.value = true;
}

async function submitForm() {
  const name = form.name.trim();
  if (!name) return ElMessage.warning('请输入标签名称');
  saving.value = true;
  try {
    if (form.id) {
      await updateTag(form.id, { name, color: form.color });
      ElMessage.success('已更新');
    } else {
      await createTag({ name, color: form.color, parentId: form.parentId ?? undefined });
      ElMessage.success('创建成功');
    }
    formVisible.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}

async function quickColor(row, color) {
  if (!color || color === row.color) return;
  await updateTag(row.id, { name: row.name, color });
  ElMessage.success('颜色已更新');
  await load();
}

async function remove(row) {
  const childN = row.children?.length || 0;
  await ElMessageBox.confirm(
    `确定删除标签「${row.name}」？其 ${row.fileCount} 个文件不会被删除（只是去掉该标签）。` +
    (childN ? ` 其下 ${childN} 个子标签将上移一级。` : ''),
    '删除确认',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
  );
  await deleteTag(row.id);
  ElMessage.success('已删除');
  await load();
}

/* ---------- 移动层级 ---------- */
const moveVisible = ref(false);
const moveRow = ref(null);
const moveTargetId = ref(0);

// 可选父级树：排除被移动节点自身及其后代（避免在选择器里选到非法项）
const moveTreeData = computed(() => {
  if (!moveRow.value) return [];
  const blocked = new Set([moveRow.value.id]);
  const collect = (nodes) => {
    const out = [];
    for (const n of nodes) {
      if (blocked.has(n.id)) continue;
      out.push({ id: n.id, name: n.name, children: n.children?.length ? collect(n.children) : undefined });
    }
    return out;
  };
  // 先把自身后代加入 blocked
  const blockDesc = (n) => (n.children || []).forEach((c) => { blocked.add(c.id); blockDesc(c); });
  blockDesc(moveRow.value);
  return collect(tags.value);
});

function openMove(row) {
  moveRow.value = row;
  const flat = flatList.value.find((t) => t.id === row.id);
  moveTargetId.value = flat?.parentId ?? 0;
  moveVisible.value = true;
}

async function submitMove() {
  saving.value = true;
  try {
    await setTagParent(moveRow.value.id, moveTargetId.value || 0);
    ElMessage.success('层级已更新');
    moveVisible.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}

/* ---------- 多选 / 合并 ---------- */
const tableRef = ref(null);
const selected = ref([]);
function onSelectionChange(rows) {
  // 树形表格选择行即 flatList 中的节点（row-key=id）
  selected.value = rows;
}
const selectedIds = computed(() => new Set(selected.value.map((t) => t.id)));

const mergeVisible = ref(false);
const merging = ref(false);
const merge = reactive({ mode: 'existing', targetId: null, targetName: '', targetColor: '#409eff' });

const mergeableExisting = computed(() => flatList.value.filter((t) => !selectedIds.value.has(t.id)));

function openMerge() {
  if (selected.value.length < 2) return ElMessage.warning('请至少勾选两个标签再合并');
  merge.mode = 'existing';
  merge.targetId = mergeableExisting.value[0]?.id || null;
  merge.targetName = '';
  merge.targetColor = selected.value[0]?.color || '#409eff';
  mergeVisible.value = true;
}

async function submitMerge() {
  const sourceIds = selected.value.map((t) => t.id);
  let payload;
  if (merge.mode === 'existing') {
    if (!merge.targetId) return ElMessage.warning('请选择目标标签');
    payload = { sourceIds, targetId: merge.targetId, targetColor: merge.targetColor };
  } else {
    const name = merge.targetName.trim();
    if (!name) return ElMessage.warning('请输入新标签名称');
    payload = { sourceIds, targetName: name, targetColor: merge.targetColor };
  }
  await ElMessageBox.confirm(
    `确认把选中的 ${sourceIds.length} 个标签合并？该操作会影响相关文件且不可自动撤销。`,
    '合并确认',
    { type: 'warning', confirmButtonText: '确认合并', cancelButtonText: '取消' }
  );
  merging.value = true;
  try {
    const res = await mergeTags(payload);
    ElMessage.success(res?.message || '合并完成');
    mergeVisible.value = false;
    tableRef.value?.clearSelection();
    await load();
  } finally {
    merging.value = false;
  }
}

function viewFiles(row) {
  router.push({ path: '/files', query: { tag: row.name } });
}

onMounted(load);
</script>

<style scoped>
.tags-page {
  max-width: 1040px;
}
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.head-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.head-title h2 {
  margin: 0;
  font-size: 18px;
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tip {
  margin-bottom: 12px;
}
.tag-table {
  background: #fff;
  border-radius: 8px;
}
.name-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}
.own-hint {
  color: #909399;
  font-size: 12px;
  margin-left: 4px;
}
.tag-pill {
  font-size: 13px;
  border-radius: 14px;
  padding: 3px 12px;
  display: inline-flex;
  align-items: center;
}
.color-row {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-width: 240px;
}
.swatch {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  cursor: pointer;
  border: 2px solid transparent;
  box-sizing: border-box;
}
.swatch.on {
  border-color: #303133;
  transform: scale(1.12);
}
.merge-tag {
  margin: 0 6px 6px 0;
}

/* ===== 树形层级引导线与视觉优化 ===== */
.tag-table {
  border-radius: 10px;
  overflow: hidden;
}
.tag-table :deep(.el-table__row) {
  transition: background 0.15s;
}
.tag-table :deep(.el-table__row:hover > td.el-table__cell) {
  background: #f5f9ff !important;
}
/* 展开图标更精致 */
.tag-table :deep(.el-table__expand-icon) {
  color: #a8abb2;
  font-size: 13px;
  transition: transform 0.2s, color 0.2s;
  margin-right: 8px;
}
.tag-table :deep(.el-table__expand-icon--expanded) {
  color: #409eff;
}

/* 标签列缩进区画竖向引导线：依据行深度在缩进区左边加虚线 */
.tag-table :deep(.el-table__indent) {
  position: relative;
}
/* 每一级缩进 16px；用伪元素在每级缩进中线画竖线（最多支持 6 级）*/
.tag-table :deep(.el-table__indent)::before {
  content: '';
  position: absolute;
  top: -10px;
  bottom: -10px;
  left: 8px;
  width: 1px;
  background: transparent;
}
/* 有子层级的行：缩进格画竖线，颜色淡 */
.tag-table :deep(tr.tag-depth-1 .el-table__indent)::before,
.tag-table :deep(tr.tag-depth-2 .el-table__indent)::before,
.tag-table :deep(tr.tag-depth-3 .el-table__indent)::before,
.tag-table :deep(tr.tag-depth-4 .el-table__indent)::before,
.tag-table :deep(tr.tag-depth-5 .el-table__indent)::before {
  background: #e2e6ee;
}
.tag-table :deep(tr.tag-depth-2 .el-table__indent)::before { left: 24px; }
.tag-table :deep(tr.tag-depth-3 .el-table__indent)::before { left: 40px; }
.tag-table :deep(tr.tag-depth-4 .el-table__indent)::before { left: 56px; }
.tag-table :deep(tr.tag-depth-5 .el-table__indent)::before { left: 72px; }

/* 子级行标签名轻微缩进感（靠缩进格本身，这里加强层次底色）*/
.tag-table :deep(tr.tag-depth-1) .name-cell .tag-pill,
.tag-table :deep(tr.tag-depth-2) .name-cell .tag-pill,
.tag-table :deep(tr.tag-depth-3) .name-cell .tag-pill {
  font-weight: 500;
}
.tag-table :deep(tr.tag-depth-0) .name-cell .tag-pill {
  font-weight: 700;
  font-size: 14px;
}
</style>
