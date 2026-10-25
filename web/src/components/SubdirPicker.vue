<template>
  <div class="subdir-picker">
    <el-form-item label="存储到">
      <div class="pick-row">
        <el-select
          :model-value="rootId"
          class="root-sel"
          placeholder="存储盘"
          @update:model-value="onRootChange"
        >
          <el-option
            v-for="r in roots"
            :key="r.id"
            :label="rootLabel(r)"
            :value="r.id"
            :disabled="!r.exists || !r.writable"
          >
            <span>{{ rootLabel(r) }}</span>
            <el-tag v-if="r.isCurrent" size="small" type="success" style="margin-left:6px">当前</el-tag>
          </el-option>
        </el-select>

        <el-tree-select
          v-model="subdir"
          :data="treeData"
          :props="{ label: 'name', value: 'path', children: 'children' }"
          :render-after-expand="false"
          check-strictly
          filterable
          allow-create
          default-first-option
          clearable
          placeholder="选择或输入子目录（可多级，如 德芙/2026）"
          class="dir-sel"
          @change="emitChange"
        >
          <template #empty>
            <div class="empty-tip">暂无子目录，可直接输入名称（用 / 分层，自动创建）</div>
          </template>
        </el-tree-select>
      </div>
      <div class="hint">
        目录每一级都会自动变成标签（如 德芙/2026 → 标签「德芙」「2026」），上传后无需手动补标签
      </div>
    </el-form-item>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { getStorageRoots, getStorageSubdirs } from '../api/storage.js';

const props = defineProps({
  modelValue: { type: String, default: '' }, // 子目录
  root: { type: [Number, null], default: null }, // 存储根 id，null=当前根
});
const emit = defineEmits(['update:modelValue', 'update:root', 'change']);

const roots = ref([]);
const rootId = ref(0);
const subdir = ref(props.modelValue || '');
const subdirs = ref([]);

function rootLabel(r) {
  if (r.isDefault) return `${r.path}（默认）`;
  return r.label ? `${r.label} · ${r.path}` : r.path;
}

// 把平铺相对路径数组构造成树
const treeData = computed(() => {
  const root = { name: '根目录', path: '', children: [] };
  const map = new Map([['', root]]);
  for (const p of subdirs.value) {
    const segs = p.split('/');
    let acc = '';
    let parent = root;
    segs.forEach((seg, i) => {
      acc = acc ? `${acc}/${seg}` : seg;
      if (!map.has(acc)) {
        const node = { name: seg, path: acc, children: [] };
        map.set(acc, node);
        parent.children.push(node);
      }
      parent = map.get(acc);
    });
  }
  return root.children;
});

async function loadRoots() {
  roots.value = (await getStorageRoots()).roots || [];
  // 默认选中“当前根”
  const cur = roots.value.find((r) => r.isCurrent) || roots.value[0];
  rootId.value = props.root != null ? props.root : cur?.id ?? 0;
  await loadSubdirs();
}

async function loadSubdirs() {
  try {
    subdirs.value = (await getStorageSubdirs(rootId.value)).subdirs || [];
  } catch {
    subdirs.value = [];
  }
}

async function onRootChange(v) {
  rootId.value = v;
  emit('update:root', v);
  await loadSubdirs();
  emitChange();
}

function emitChange() {
  emit('update:modelValue', subdir.value || '');
  emit('change', { rootId: rootId.value, subdir: subdir.value || '' });
}

watch(() => props.modelValue, (v) => { subdir.value = v || ''; });
watch(subdir, () => emitChange());

onMounted(loadRoots);

defineExpose({
  get value() {
    return { rootId: rootId.value, subdir: subdir.value || '' };
  },
});
</script>

<style scoped>
.pick-row {
  display: flex;
  gap: 8px;
  width: 100%;
}
.root-sel {
  width: 200px;
  flex-shrink: 0;
}
.dir-sel {
  flex: 1;
}
.hint {
  color: #909399;
  font-size: 12px;
  margin-top: 4px;
}
.empty-tip {
  padding: 6px 10px;
  color: #909399;
  font-size: 12px;
}
</style>
