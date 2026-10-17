import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { cardCatalog } from '../packages/game-data/src/index.ts'
import { validateDeck } from '../packages/game-core/src/deck.ts'

const baseURL = process.env.BFW_SMOKE_ORIGIN ?? 'http://localhost:8080'
const suffix = `${process.env.GITHUB_RUN_ID ?? 'local'}${Date.now()}`.replace(/[^a-z0-9]/giu, '').slice(-12)
const password = 'Compose-CI-password-42'
const browser = await chromium.launch({ headless: true })
const contexts = []

function smokeDeck(withPrivateChoice = false) {
  const cards = cardCatalog.filter(card => !card.Tags?.includes('в разработке'))
  const classes = new Set([0, 1])
  const bee = cards.find(card => card.Name === 'Обсидиан пчёла' && card.Rarity === 0 && card.Cost === 1)
  const privateChoice = cards.find(card => card.Name === 'Ваня Веремеев' && card.Rarity === 1 && card.Cost === 2)
  const take = (rarity, count, maxCopies = 2) => {
    const ids = []
    for (const card of cards.filter(card => card.Rarity === rarity && classes.has(card.Class) && card.Cost > 2 && card.Id !== bee?.Id && card.Id !== privateChoice?.Id)) {
      for (let copy = 0; copy < maxCopies && ids.length < count; copy++) ids.push(card.Id)
    }
    if (ids.length !== count) throw new Error(`Could not build a legal acceptance deck for rarity ${rarity}`)
    return ids
  }
  const ids = withPrivateChoice
    ? [bee?.Id, privateChoice?.Id, ...take(0, 14), ...take(1, 11), ...take(2, 3, 1)]
    : [bee?.Id, bee?.Id, ...take(0, 13), ...take(1, 12), ...take(2, 3, 1)]
  if (!bee || !validateDeck(ids, cards)) throw new Error('Could not build a legal deck with a guaranteed first-turn creature')
  if (withPrivateChoice && !privateChoice) throw new Error('Could not find the private-choice acceptance card')
  return ids
}

try {
  const deckHome = await browser.newPage()
  await deckHome.goto(baseURL)
  await expect(deckHome.getByRole('button', { name: 'Редактор колод' })).toBeVisible()
  await deckHome.getByRole('button', { name: 'Редактор колод' }).click()
  await expect(deckHome.getByRole('heading', { name: 'Мои колоды' })).toBeVisible()
  await expect(deckHome.getByRole('button', { name: 'Войти / Создать аккаунт' })).toBeVisible()
  await deckHome.getByRole('button', { name: '← На главную' }).click()
  await deckHome.getByRole('button', { name: 'Начать игру' }).click()
  await deckHome.getByRole('button', { name: 'Локальная игра' }).click()
  await expect(deckHome.getByRole('heading', { name: 'Выберите колоду' })).toBeVisible()
  await expect(deckHome.locator('.deck-choice')).toHaveCount(3)
  await deckHome.locator('.deck-choice').filter({ hasText: 'Передовая' }).click()
  await deckHome.getByRole('button', { name: 'Выбрать колоду' }).click()
  await deckHome.locator('.deck-choice').filter({ hasText: 'Контроль поля' }).click()
  await expect(deckHome.getByRole('heading', { name: 'Передайте устройство' })).toBeVisible()
  await deckHome.close()

  const players = await Promise.all(['owner', 'guest'].map(async role => {
    const context = await browser.newContext()
    contexts.push(context)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(baseURL)
    await page.getByRole('button', { name: 'Начать игру' }).click()
    await page.getByRole('button', { name: 'Онлайн-лобби' }).click()
    await page.getByRole('button', { name: 'Нужен аккаунт? Зарегистрироваться' }).click()
    const username = `pw${role}${suffix}`
    await page.getByLabel('Логин').fill(username)
    await page.getByLabel('Пароль').fill(password)
    await page.getByRole('button', { name: 'Зарегистрироваться' }).click()
    await expect(page.getByRole('button', { name: 'Создать комнату' })).toBeEnabled({ timeout: 15000 })
    const starterNames = await page.evaluate(async () => (await fetch('/api/v1/decks').then(response => response.json())).items.map(deck => deck.name))
    assert.deepEqual(starterNames.sort(), ['Передовая', 'Контроль поля', 'Ресурсный прорыв'].sort())
    const profileButton = page.getByRole('button', { name: /Открыть профиль/ })
    await expect(profileButton).toBeVisible()
    await expect(page.locator('.profile-settings')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toHaveCount(0)
    await profileButton.click()
    const profileDrawer = page.getByRole('dialog', { name: 'Профиль аккаунта' })
    await expect(profileDrawer).toBeVisible()
    await profileDrawer.getByLabel('Никнейм').fill('Ник ' + role)
    await profileDrawer.getByRole('button', { name: 'Сохранить никнейм' }).click()
    await expect(profileButton).toContainText('Ник ' + role)
    await profileDrawer.locator('#profile-avatar-file').setInputFiles('apps/web/public/card_back.png')
    await expect(profileDrawer.getByRole('status')).toContainText('Аватар обновлён')
    await profileDrawer.getByLabel('Текущий пароль').fill(password)
    await profileDrawer.getByLabel('Новый пароль').fill('Changed-compose-password-43')
    await profileDrawer.getByRole('button', { name: 'Изменить пароль' }).click()
    await expect(profileDrawer.getByRole('status')).toContainText('Пароль изменён')
    await profileDrawer.getByRole('button', { name: 'Закрыть профиль' }).click()
    return { context, page, username, errors }
  }))

  const owner = players[0]
  const guest = players[1]
  await owner.page.getByRole('button', { name: '← К режимам' }).click()
  await owner.page.getByRole('button', { name: '← На главную' }).click()
  await owner.page.getByRole('button', { name: 'Редактор колод' }).click()
  await expect(owner.page.locator('.saved-deck-tile')).toHaveCount(3)
  await expect(owner.page.locator('.saved-deck-tile .card-stack img').first()).toBeVisible()
  const starterTile = owner.page.locator('.saved-deck-tile').filter({ hasText: 'Передовая' })
  await starterTile.getByRole('button', { name: 'Изменить' }).click()
  await owner.page.getByLabel('Название колоды').fill('Передовая smoke')
  await owner.page.getByRole('button', { name: 'Сохранить и выйти' }).click()
  await expect(owner.page.locator('.saved-deck-tile').filter({ hasText: 'Передовая smoke' })).toBeVisible()
  await owner.page.getByRole('button', { name: 'Создать новую колоду' }).click()
  await owner.page.getByLabel('Название колоды').fill('Черновик smoke')
  await owner.page.getByRole('button', { name: 'Сохранить и выйти' }).click()
  const draftTile = owner.page.locator('.saved-deck-tile').filter({ hasText: 'Черновик smoke' })
  await expect(draftTile).toBeVisible()
  await draftTile.getByRole('button', { name: 'Удалить' }).click()
  const deleteDialog = owner.page.getByRole('dialog', { name: /Удалить «Черновик smoke»/ })
  await expect(deleteDialog).toBeVisible()
  await deleteDialog.getByRole('button', { name: 'Удалить колоду' }).click()
  await expect(draftTile).toHaveCount(0)
  await owner.page.getByRole('button', { name: '← На главную' }).click()
  await owner.page.getByRole('button', { name: 'Начать игру' }).click()
  await owner.page.getByRole('button', { name: 'Локальная игра' }).click()
  await expect(owner.page.locator('.deck-choice')).toHaveCount(3)
  await owner.page.locator('.deck-choice').first().click()
  await owner.page.getByRole('button', { name: 'Выбрать колоду' }).click()
  await owner.page.locator('.deck-choice').nth(1).click()
  await expect(owner.page.getByRole('button', { name: 'Начать ход' })).toBeVisible()
  await owner.page.reload()
  await owner.page.getByRole('button', { name: 'Начать игру' }).click()
  await owner.page.getByRole('button', { name: 'Онлайн-лобби' }).click()
  await expect(owner.page.getByRole('button', { name: 'Создать комнату' })).toBeEnabled({ timeout: 15000 })
  await owner.page.getByRole('button', { name: 'Создать комнату' }).click()
  const roomTitle = await owner.page.getByRole('heading', { name: /^Комната / }).textContent()
  const code = roomTitle?.match(/[A-Z0-9]{8}/)?.[0]
  assert.ok(code, `room code was not shown: ${roomTitle}`)
  await guest.page.getByLabel('Код приглашения').fill(code)
  await guest.page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(guest.page.getByRole('heading', { name: `Комната ${code}` })).toBeVisible()

  const deterministicDeckNames = await Promise.all(players.map(async (player, index) => {
    const name = `Acceptance opening ${index}`
    const counts = new Map()
    for (const id of smokeDeck(index === 0)) counts.set(id, (counts.get(id) ?? 0) + 1)
    await player.page.evaluate(async ({ name, cards }) => {
      const csrf = await fetch('/api/v1/auth/csrf').then(response => response.json())
      const response = await fetch('/api/v1/decks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf.csrfToken },
        body: JSON.stringify({ name, cards }),
      })
      if (!response.ok) throw new Error(`Could not create deterministic test deck: ${response.status}`)
    }, { name, cards: [...counts].map(([cardId, quantity]) => ({ cardId, quantity })) })
    await player.page.reload()
    await player.page.getByRole('button', { name: 'Начать игру' }).click()
    await player.page.getByRole('button', { name: 'Онлайн-лобби' }).click()
    await expect(player.page.getByRole('heading', { name: `Комната ${code}` })).toBeVisible({ timeout: 15000 })
    return name
  }))

  await Promise.all(players.map(async player => {
    const index = players.indexOf(player)
    await expect(player.page.locator('.online-deck-tile')).toHaveCount(4, { timeout: 15000 })
    const deckId = await player.page.locator('.online-deck-tile').filter({ hasText: deterministicDeckNames[index] }).getByRole('radio').getAttribute('value')
    assert.ok(deckId, `deterministic deck is missing for ${player.username}`)
    await player.page.getByRole('radio', { name: 'Колода ' + deterministicDeckNames[index], exact: true }).check()
    await expect(player.page.getByText(/Выбрана колода:/)).toBeVisible()
  }))
  await expect(guest.page.getByRole('button', { name: 'Начать партию' })).toHaveCount(0)
  await owner.page.getByRole('button', { name: 'Готов', exact: true }).click()
  await expect(owner.page.getByRole('button', { name: 'Начать партию' })).toBeDisabled()
  await guest.page.getByRole('button', { name: 'Готов', exact: true }).click()
  await expect(owner.page.getByRole('button', { name: 'Начать партию' })).toBeEnabled({ timeout: 15000 })
  await owner.page.getByRole('button', { name: 'Начать партию' }).click()
  await Promise.all(players.map(async player => {
    await expect(player.page.locator('.battlefield-wrap')).toBeVisible({ timeout: 15000 })
    await expect(player.page.locator('.match-hand > .hand-card')).toHaveCount(4)
  }))
  await expect(owner.page.locator('.match-hand > .hand-card:has(img[alt="Обсидиан пчёла"])')).toHaveCount(1)
  await expect(owner.page.locator('.match-hand > .hand-card:has(img[alt="Ваня Веремеев"])')).toHaveCount(1)
  await expect(guest.page.locator('.match-hand > .hand-card:has(img[alt="Обсидиан пчёла"])')).toHaveCount(2)
  await owner.page.locator('.match-hand > .hand-card:has(img[alt="Обсидиан пчёла"])').first().click()
  await owner.page.getByRole('button', { name: 'Свободная клетка Д3' }).click()
  await Promise.all(players.map(player => expect(player.page.locator('.slot.occupied')).toHaveCount(1)))
  await expect(owner.page.locator('.match-hand > .hand-card')).toHaveCount(3)
  await owner.page.getByRole('button', { name: 'Завершить ход' }).click()
  await expect(guest.page.getByRole('button', { name: 'Завершить ход' })).toBeVisible({ timeout: 10000 })
  await expect(owner.page.getByRole('button', { name: 'Завершить ход' })).toHaveCount(0)
  await guest.page.locator('.match-hand > .hand-card:has(img[alt="Обсидиан пчёла"])').first().click()
  await guest.page.getByRole('button', { name: 'Свободная клетка А3' }).click()
  await Promise.all(players.map(player => expect(player.page.locator('.slot.occupied')).toHaveCount(2)))
  await guest.page.getByRole('button', { name: 'Завершить ход' }).click()
  await expect(owner.page.getByRole('button', { name: 'Завершить ход' })).toBeVisible({ timeout: 10000 })
  await owner.page.locator('.match-hand > .hand-card:has(img[alt="Ваня Веремеев"])').click()
  await owner.page.getByRole('button', { name: 'Свободная клетка Д4' }).click()
  const choiceTitle = 'Выбор эффекта «Ваня Веремеев»'
  await expect(owner.page.getByRole('heading', { name: choiceTitle })).toBeVisible({ timeout: 10000 })
  await expect(guest.page.locator('.battlefield .slot.occupied:has(img.card-front[alt="Ваня Веремеев"])')).toHaveCount(1)
  await expect(guest.page.getByRole('heading', { name: choiceTitle })).toHaveCount(0)
  await expect(guest.page.locator('.battlefield .slot.occupied:has(img.card-front[alt="Обсидиан пчёла"])')).toHaveCount(2)
  await owner.page.locator('.online-choice').getByRole('button', { name: 'Обсидиан пчёла' }).click()
  await expect(owner.page.locator('.online-choice summary')).toContainText('Сбережения · 1')
  await expect(guest.page.locator('.battlefield .slot.occupied:has(img.card-front[alt="Обсидиан пчёла"])')).toHaveCount(1)
  await expect(guest.page.locator('.online-choice summary')).toHaveCount(0)
  await owner.page.getByRole('button', { name: 'Завершить ход' }).click()
  await expect(guest.page.getByRole('button', { name: 'Завершить ход' })).toBeVisible({ timeout: 10000 })
  await guest.page.getByRole('button', { name: 'Завершить ход' }).click()
  await guest.page.getByRole('dialog', { name: 'Ход без розыгрыша' }).getByRole('button', { name: 'Завершить ход', exact: true }).click()
  await expect(owner.page.getByRole('button', { name: 'Завершить ход' })).toBeVisible({ timeout: 10000 })
  await guest.page.getByRole('button', { name: 'Сдаться' }).click()
  await Promise.all(players.map(async player => {
    await expect(player.page.getByRole('heading', { name: `Комната ${code}` })).toBeVisible({ timeout: 15000 })
    await expect(player.page.locator('.battlefield-wrap')).toHaveCount(0)
    await expect(player.page.getByRole('button', { name: 'Готов', exact: true })).toBeEnabled()
  }))
  await guest.page.getByRole('button', { name: 'Покинуть комнату' }).click()
  await expect(guest.page.getByRole('button', { name: 'Создать комнату' })).toBeEnabled()
  await expect(owner.page.getByRole('heading', { name: `Комната ${code}` })).toBeVisible()
  await guest.page.getByLabel('Код приглашения').fill(code)
  await guest.page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(guest.page.getByRole('heading', { name: `Комната ${code}` })).toBeVisible()
  await owner.page.route('**/api/v1/rooms/*/leave', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"DATABASE_UNAVAILABLE"}' }))
  await owner.page.getByRole('button', { name: 'Покинуть комнату' }).click()
  await expect(owner.page.getByRole('status')).toContainText('Сервер временно не может сохранить изменение.')
  await expect(owner.page.getByRole('heading', { name: `Комната ${code}` })).toBeVisible()
  await owner.page.unroute('**/api/v1/rooms/*/leave')
  await owner.page.getByRole('button', { name: 'Покинуть комнату' }).click()
  await Promise.all(players.map(player => expect(player.page.getByRole('button', { name: 'Создать комнату' })).toBeEnabled()))

  for (const player of players) {
    const cookies = await player.context.cookies(baseURL)
    assert.ok(cookies.some(cookie => cookie.name === 'bfw_session_dev'), 'browser context has no session cookie')
    assert.deepEqual(player.errors, [], `${player.username} had browser errors`)
  }
  const ownerCookie = (await owner.context.cookies(baseURL)).find(cookie => cookie.name === 'bfw_session_dev')
  const guestCookie = (await guest.context.cookies(baseURL)).find(cookie => cookie.name === 'bfw_session_dev')
  assert.notEqual(ownerCookie?.value, guestCookie?.value, 'browser contexts shared an account session')
  console.log('Two independent browser contexts played and conceded, resolved a private choice, verified guest leave/return, preserved the owner room on leave failure, and closed it on retry.')
} finally {
  await Promise.all(contexts.map(context => context.close()))
  await browser.close()
}
