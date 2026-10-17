<script setup lang="ts">
import { nextTick, onUnmounted, ref } from 'vue'

type InspectedCard = {
  Name: string; Description?: string; Type: number; Class?: number
  Cost?: number; Attack?: number; Health?: number; Speed?: number
}
const card = ref<InspectedCard | null>(null)
const panel = ref<HTMLElement | null>(null)
const hand = ref(false), below = ref(false), measuring = ref(false), tall = ref(false)
const width = ref(280), position = ref({ left: 0, top: 0 })
const kinds = ['Существо', 'Предмет', 'Заклинание', 'Здание']
const classes = ['Тфер', 'Симп', 'Метрокоп', 'Токсик', 'Темщик', 'Гэмблер']
let timer: number | undefined

function keep() {
  window.clearTimeout(timer)
  timer = undefined
}
function hide() {
  keep()
  card.value = null
}
function show(nextCard: InspectedCard, target: HTMLElement) {
  keep()
  timer = window.setTimeout(async () => {
    timer = undefined
    if (!target.isConnected) return
    const rect = target.getBoundingClientRect()
    hand.value = target.classList.contains('hand-card')
    below.value = !hand.value && rect.top < 245
    width.value = window.innerWidth <= 780 ? 160 : 280
    position.value = hand.value
      ? { left: Math.max(width.value + 12, rect.left), top: rect.top + rect.height / 2 }
      : { left: rect.left + rect.width / 2, top: below.value ? rect.bottom + 8 : rect.top - 8 }
    card.value = nextCard
    measuring.value = hand.value
    tall.value = false
    await nextTick()
    if (!hand.value || card.value?.Name !== nextCard.Name) return
    const content = panel.value?.firstElementChild as HTMLElement | null
    const text = content?.querySelector('p:not(.eyebrow)') as HTMLElement | null
    if (!content || !text) return
    const availableWidth = Math.min(560, position.value.left - 12)
    const overflows = () => text.scrollHeight > text.clientHeight + 1 || content.scrollHeight > content.clientHeight + 1
    while (overflows() && width.value < availableWidth) {
      width.value = Math.min(availableWidth, width.value + 40)
      await nextTick()
      if (card.value?.Name !== nextCard.Name) return
    }
    tall.value = overflows()
    measuring.value = false
  }, 350)
}
const art = (name: string) => '/cards/' + encodeURIComponent(name).replaceAll('%40', '@') + '.png'
function imageError(event: Event) { (event.currentTarget as HTMLImageElement).src = '/card_back.png' }
defineExpose({ show, hide })
onUnmounted(hide)
</script>

<template>
  <aside v-if="card" :key="card.Name" ref="panel" class="card-inspector" role="tooltip"
    :class="{ below, 'hand-description': hand, measuring, 'full-text': tall }"
    :style="{ left: position.left + 'px', top: position.top + 'px', '--description-width': width + 'px' }"
    @mouseenter="keep" @mouseleave="hide" @focusin="keep" @focusout="hide">
    <img v-if="!hand" :src="art(card.Name)" :alt="card.Name" @error="imageError">
    <div>
      <p class="eyebrow">{{ kinds[card.Type] }}<template v-if="card.Class !== undefined"> · {{ classes[card.Class] }}</template></p>
      <h3>{{ card.Name }}</h3>
      <p>{{ card.Description }}</p>
      <div class="stats">
        <span v-if="card.Cost !== undefined" class="inspector-cost">✦{{ card.Cost }}</span>
        <template v-if="card.Type === 0">
          <span class="inspector-attack">⚔ {{ card.Attack }}</span><span>♥ {{ card.Health }}</span><span>⚡ {{ card.Speed }}</span>
        </template>
      </div>
    </div>
  </aside>
</template>
