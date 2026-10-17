<script setup lang="ts">
defineProps<{ seat: number }>()
</script>

<template>
  <div class="battlefield-wrap">
    <slot name="profiles" />
    <div class="axis axis-top"><span v-for="column in (seat === 1 ? [5, 4, 3, 2, 1] : [1, 2, 3, 4, 5])" :key="column">{{ column }}</span></div>
    <div class="battlefield" :class="{ p2: seat === 1 }" role="group" aria-label="Игровое поле, ряды А–Д и столбцы 1–5">
      <slot name="effects" />
      <div v-for="row in 5" :key="row" class="board-row">
        <slot v-for="column in 5" :key="column" name="cell" :row="row - 1" :col="column - 1" />
      </div>
    </div>
    <div class="axis axis-right"><span v-for="letter in (seat === 1 ? ['Д', 'Г', 'В', 'Б', 'А'] : ['А', 'Б', 'В', 'Г', 'Д'])" :key="letter">{{ letter }}</span></div>
  </div>
</template>
