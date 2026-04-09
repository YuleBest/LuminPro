<script setup>
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: String, default: '' },
  modelValue: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  id: { type: String, default: undefined },
})

const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :disabled="disabled"
    :id="id"
    :class="
      cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        modelValue
          ? 'bg-primary border-2 border-transparent'
          : 'bg-transparent border-2 border-muted-foreground/40',
        props.class,
      )
    "
    @click="emit('update:modelValue', !modelValue)"
  >
    <span
      :class="
        cn(
          'pointer-events-none block rounded-full shadow-sm ring-0 transition-all duration-200',
          modelValue
            ? 'h-5 w-5 translate-x-5 bg-white'
            : 'h-4 w-4 translate-x-0.5 bg-muted-foreground/60',
        )
      "
    />
  </button>
</template>
