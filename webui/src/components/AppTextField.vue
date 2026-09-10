<script setup>
/** md-outlined-text-field 的 v-model 封装（MWC 用属性而非 Vue props，需手动接线） */
defineProps({
  modelValue: { type: [String, Number], default: '' },
  label: { type: String, default: '' },
  type: { type: String, default: 'text' },
  min: { type: [String, Number], default: undefined },
  max: { type: [String, Number], default: undefined },
  step: { type: [String, Number], default: undefined },
  supportingText: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  placeholder: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

function onInput(event) {
  emit('update:modelValue', event.target.value)
}
</script>

<template>
  <md-outlined-text-field
    :label="label"
    :type="type"
    :value="modelValue"
    :min="min"
    :max="max"
    :step="step"
    :supporting-text="supportingText"
    :disabled="disabled"
    :placeholder="placeholder"
    autocomplete="off"
    spellcheck="false"
    @input="onInput"
  ></md-outlined-text-field>
</template>
