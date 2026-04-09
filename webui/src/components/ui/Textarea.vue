<script setup>
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: String, default: '' },
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  rows: { type: Number, default: 2 },
})

const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <textarea
    v-bind="$attrs"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :rows="rows"
    :class="
      cn(
        'flex min-h-15 w-full rounded-md border border-input bg-muted px-3 py-2 text-sm font-mono text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 resize-vertical',
        props.class,
      )
    "
    @input="emit('update:modelValue', $event.target.value)"
  />
</template>
