<template>
  <aside class="property-panel">
    <div class="property-panel__header">
      <h3>属性面板</h3>
      <p>选中节点或连线后，可以在这里编辑它的业务属性。</p>
    </div>

    <div v-if="!selectedElement" class="property-panel__empty">
      请选择一个节点或连线
    </div>

    <div v-else-if="selectedElement.kind === 'multiple'" class="property-panel__empty">
      当前选中了多个元素，暂不支持批量编辑
    </div>

    <template v-else-if="selectedElement.kind === 'node'">
      <div class="property-panel__meta">
        <span>节点 ID：{{ selectedElement.data.id }}</span>
        <span>节点类型：{{ selectedElement.data.type || 'rect' }}</span>
      </div>

      <el-form label-position="top" class="property-panel__form">
        <el-form-item label="节点名称">
          <el-input
            :model-value="form.text"
            placeholder="请输入节点名称"
            @update:model-value="updateText"
          />
        </el-form-item>

        <el-form-item label="审批人">
          <el-input
            :model-value="form.assignee"
            placeholder="请输入审批人"
            @update:model-value="updateAssignee"
          />
        </el-form-item>

        <el-form-item label="描述">
          <el-input
            type="textarea"
            :rows="4"
            :model-value="form.description"
            placeholder="请输入节点描述"
            @update:model-value="updateDescription"
          />
        </el-form-item>

        <el-form-item label="超时时间（分钟）">
          <el-input-number
            :model-value="form.timeoutMinutes"
            :min="0"
            :max="9999"
            controls-position="right"
            @update:model-value="updateTimeoutMinutes"
          />
        </el-form-item>

        <el-form-item label="备注">
          <el-input
            type="textarea"
            :rows="3"
            :model-value="form.remark"
            placeholder="补充节点说明"
            @update:model-value="updateRemark"
          />
        </el-form-item>
      </el-form>
    </template>

    <template v-else-if="selectedElement.kind === 'edge'">
      <div class="property-panel__meta">
        <span>连线 ID：{{ selectedElement.data.id }}</span>
        <span>
          路径：{{ selectedElement.data.sourceNodeId }} -> {{ selectedElement.data.targetNodeId }}
        </span>
      </div>

      <el-form label-position="top" class="property-panel__form">
        <el-form-item label="连线文本">
          <el-input
            :model-value="form.text"
            placeholder="请输入连线文本"
            @update:model-value="updateText"
          />
        </el-form-item>

        <el-form-item label="条件表达式">
          <el-input
            type="textarea"
            :rows="4"
            :model-value="form.condition"
            placeholder="例如：score >= 60"
            @update:model-value="updateCondition"
          />
        </el-form-item>

        <el-form-item label="优先级">
          <el-input-number
            :model-value="form.priority"
            :min="1"
            :max="99"
            controls-position="right"
            @update:model-value="updatePriority"
          />
        </el-form-item>

        <el-form-item label="备注">
          <el-input
            type="textarea"
            :rows="3"
            :model-value="form.remark"
            placeholder="补充连线说明"
            @update:model-value="updateRemark"
          />
        </el-form-item>
      </el-form>
    </template>

    <div v-if="selectedElement && selectedElement.kind !== 'multiple'" class="property-panel__actions">
      <el-button type="primary" @click="emit('apply')">应用修改</el-button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import type { BatchEditPayload, PropertyForm, SelectedElement } from '@/types/flow';

const props = defineProps<{
  selectedElement: SelectedElement;
  form: PropertyForm;
}>();

const emit = defineEmits<{
  (e: 'update:form', value: PropertyForm): void;
  (e: 'apply'): void;
  (e: 'apply-batch', payload: BatchEditPayload): void;
}>();

// 批量编辑表单：先勾选字段再填写，只有勾选的字段会进入应用载荷，
// 这样用户可以只改审批人而不用担心覆盖其它属性。
const batchForm = reactive({
  applyAssignee: false,
  assignee: '',
  applyTimeout: false,
  timeoutMinutes: 30,
  applyRemark: false,
  remark: '',
  applyType: false,
  nodeType: 'rect' as 'rect' | 'diamond',
});

const handleApplyBatch = () => {
  const payload: BatchEditPayload = {};
  if (batchForm.applyAssignee) payload.assignee = batchForm.assignee;
  if (batchForm.applyTimeout) payload.timeoutMinutes = batchForm.timeoutMinutes;
  if (batchForm.applyRemark) payload.remark = batchForm.remark;
  if (batchForm.applyType) payload.nodeType = batchForm.nodeType;
  emit('apply-batch', payload);
};

// 右侧表单只维护“当前输入值”，真正写回 LogicFlow 由父组件统一处理。
const updateField = <K extends keyof PropertyForm>(key: K, value: PropertyForm[K]) => {
  emit('update:form', {
    ...props.form,
    [key]: value,
  });
};

const updateText = (value: string) => updateField('text', value);
const updateAssignee = (value: string) => updateField('assignee', value);
const updateDescription = (value: string) => updateField('description', value);
const updateCondition = (value: string) => updateField('condition', value);
const updateTimeoutMinutes = (value: number | undefined) => updateField('timeoutMinutes', value ?? 0);
const updateRemark = (value: string) => updateField('remark', value);

// InputNumber 可能给出 undefined，这里统一回落到 1，避免表单里出现空值。
const updatePriority = (value: number | undefined) => updateField('priority', value ?? 1);
</script>

<style scoped>
.property-panel {
  width: 320px;
  padding: 20px 18px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(18px);
  box-shadow: var(--app-shadow);
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.property-panel__header h3 {
  margin: 0 0 6px;
  font-size: 18px;
  color: #102033;
}

.property-panel__header p {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: #5f6c82;
}

.property-panel__empty {
  padding: 18px 14px;
  border: 1px dashed rgba(15, 23, 42, 0.12);
  border-radius: 14px;
  background: #f8fbff;
  color: #6b7280;
  line-height: 1.7;
}

.property-panel__meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 14px;
  background: #f8fbff;
  border: 1px solid rgba(15, 23, 42, 0.08);
  color: #5f6c82;
  font-size: 13px;
}

.property-panel__form {
  padding: 16px 14px 0;
  border-radius: 14px;
  background: #fff;
  border: 1px solid rgba(15, 23, 42, 0.08);
}

.property-panel__actions {
  display: flex;
  justify-content: flex-end;
}

.property-panel__batch-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
}

.property-panel__batch-row .el-checkbox {
  flex-shrink: 0;
  width: 104px;
  margin-right: 0;
}

.property-panel__batch-row .el-input,
.property-panel__batch-row .el-input-number,
.property-panel__batch-row .el-select {
  flex: 1;
}

.property-panel :deep(.el-form-item__label) {
  color: #102033;
}

.property-panel :deep(.el-input__wrapper),
.property-panel :deep(.el-textarea__inner),
.property-panel :deep(.el-input-number__decrease),
.property-panel :deep(.el-input-number__increase) {
  border-radius: 12px;
  background: #f8fbff;
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08);
}

.property-panel :deep(.el-input__inner),
.property-panel :deep(.el-textarea__inner) {
  color: #102033;
}

.property-panel :deep(.el-input-number__decrease),
.property-panel :deep(.el-input-number__increase) {
  background: #f8fbff;
  border: none;
  color: #102033;
}

.property-panel :deep(.el-button--primary) {
  border: none;
  background: linear-gradient(135deg, #2563eb 0%, #0f766e 100%);
}
</style>
