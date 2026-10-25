import { defineStore } from 'pinia';

/**
 * 文件表格列显示设置（持久化到 localStorage）。
 * true=显示，false=隐藏。默认全部显示。
 */
const STORAGE_KEY = 'fms_table_columns';

const DEFAULTS = {
  originDate: true, // 原始日期
  uploader: true,   // 上传人
  uploadTime: true, // 上传时间
};

function load() {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export const useTableSettingsStore = defineStore('tableSettings', {
  state: () => ({
    columns: load(),
  }),
  getters: {
    // 便于模板直接用 showOriginDate 等
    showOriginDate: (s) => s.columns.originDate,
    showUploader: (s) => s.columns.uploader,
    showUploadTime: (s) => s.columns.uploadTime,
  },
  actions: {
    toggle(key, val) {
      if (!(key in this.columns)) return;
      this.columns[key] = typeof val === 'boolean' ? val : !this.columns[key];
      this.persist();
    },
    reset() {
      this.columns = { ...DEFAULTS };
      this.persist();
    },
    persist() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.columns));
    },
  },
});
