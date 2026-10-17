import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { cardCatalog } from '../packages/game-data/src/index.ts'
import { validateDeck } from '../packages/game-core/src/deck.ts'

const origin = process.env.BFW_SMOKE_ORIGIN ?? 'http://localhost:8081'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'This check creates local test accounts')
const browser = await chromium.launch({ headless: true })
const errors = []
const pageFor = async (options = {}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...options })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  return page
}
const cell = (page, row, col) => page.locator(`.slot[data-row="${row}"][data-col="${col}"]`)
async function drag(page, source, target, touch = false, cancel = false) {
  if (!touch) { await source.hover(); await page.waitForTimeout(350) }
  const from = await source.boundingBox(), to = await target.boundingBox()
  assert.ok(from && to)
  const x = from.x + from.width / 2, y = Math.min(710, from.y + Math.min(from.height / 2, 35))
  const tx = to.x + to.width / 2, ty = to.y + to.height / 2
  if (touch) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let step = 1; step <= 20; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (tx - x) * step / 20, y: y + (ty - y) * step / 20 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] })
    await cdp.detach()
  } else {
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(tx, ty, { steps: 25 })
    if (cancel) await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })))
    await page.mouse.up()
  }
}
async function layout(page, label) {
  const result = await page.evaluate(() => {
    const field = document.querySelector('.battlefield').getBoundingClientRect()
    const slot = document.querySelector('.slot').getBoundingClientRect()
    const hand = document.querySelector('.hand-card').getBoundingClientRect()
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, slotRatio: slot.width / slot.height, handRatio: hand.width / hand.height, fieldBottom: field.bottom, profiles: [...document.querySelectorAll('.player-profile')].map(element => { const box = element.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, left: box.left, right: box.right } }) }
  })
  assert.equal(result.scrollWidth, result.width, `${label}: horizontal document scroll`)
  assert.equal(result.scrollHeight, result.height, `${label}: vertical document scroll`)
  assert.ok(Math.abs(result.slotRatio - 213 / 285) < .02, `${label}: distorted field ${result.slotRatio}`)
  assert.ok(Math.abs(result.handRatio - 3 / 4) < .02, `${label}: distorted hand ${result.handRatio}`)
  for (const profile of result.profiles) assert.ok(profile.top >= 0 && profile.bottom <= result.height && profile.left >= 0 && profile.right <= result.width, `${label}: clipped player profile`)
  console.log('Layout passed:', label)
}
async function local(touch) {
  const page = await pageFor({ hasTouch: touch })
  await page.evaluate(() => { Math.random = () => .999999 })
  await page.getByRole('button', { name: 'Начать игру', exact: true }).click()
  await page.getByRole('button', { name: /^Локальная игра/ }).click()
  await page.locator('.deck-choice').first().click()
  await page.getByRole('button', { name: 'Выбрать колоду', exact: true }).click()
  await page.locator('.deck-choice').first().click()
  await page.getByRole('button', { name: 'Начать ход', exact: true }).click()
  await layout(page, `local ${touch ? 'touch' : 'mouse'}`)
  const bee = () => page.locator('.hand-card:has(img[alt="Обсидиан пчёла"])').first()
  await drag(page, bee(), cell(page, 4, 0), touch, true)
  await expect(page.locator('.slot .card-front')).toHaveCount(0)
  await drag(page, bee(), cell(page, 2, 0), touch)
  await expect(page.locator('.slot .card-front')).toHaveCount(0)
  await drag(page, bee(), cell(page, 4, 0), touch)
  await expect(cell(page, 4, 0).locator('.card-front')).toHaveCount(1)
  await page.getByRole('button', { name: 'Закончить ход', exact: true }).click()
  await page.getByRole('button', { name: 'Начать ход', exact: true }).click()
  await drag(page, bee(), cell(page, 0, 4), touch)
  await expect(cell(page, 0, 4).locator('.card-front')).toHaveCount(1)
  await page.getByRole('button', { name: 'Закончить ход', exact: true }).click()
  await page.getByRole('button', { name: 'Начать ход', exact: true }).click()
  await drag(page, cell(page, 4, 0), cell(page, 3, 0), touch)
  await expect(cell(page, 3, 0).locator('.card-front')).toHaveCount(1)
  await expect(cell(page, 4, 0).locator('.card-front')).toHaveCount(0)
  await page.screenshot({ path: `.run/local-${touch ? 'touch' : 'mouse'}-fixed.png` })
  await page.context().close()
  console.log('Local play, turn change and board movement passed:', touch ? 'touch' : 'mouse')
}
const api = (page, path, method = 'GET', body) => page.evaluate(async ({ path, method, body }) => {
  const csrf = method === 'GET' ? null : await fetch('/api/v1/auth/csrf').then(response => response.json())
  const response = await fetch('/api/v1' + path, { method, headers: method === 'GET' ? {} : { 'content-type': 'application/json', 'x-csrf-token': csrf.csrfToken }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: response.status, body: await response.json() }
}, { path, method, body })
function fixtureDeck() {
  const available = cardCatalog.filter(card => !card.Tags?.includes('в разработке'))
  const creature = available.find(card => card.Name === 'Безумный манекен')
  const ids = [creature.Id, creature.Id]
  for (const [rarity, count] of [[0, 13], [1, 12], [2, 3]]) {
    let taken = 0
    for (const card of available.filter(card => [0, 1].includes(card.Class) && card.Rarity === rarity && card.Cost > 2)) {
      for (let copy = 0; copy < (rarity === 2 ? 1 : 2) && taken < count; copy++, taken++) ids.push(card.Id)
      if (taken === count) break
    }
  }
  assert.ok(validateDeck(ids, cardCatalog))
  return [...new Set(ids)].map(cardId => ({ cardId, quantity: ids.filter(id => id === cardId).length }))
}
async function finishTurn(page) {
  await page.locator('.hand-title .end-turn').click()
  const dialog = page.getByRole('dialog', { name: 'Ход без розыгрыша' })
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Завершить ход', exact: true }).click()
}
async function online() {
  const players = await Promise.all(['owner', 'guest'].map(async role => {
    const page = await pageFor({ hasTouch: true })
    const username = `gameplay_${role}_local`, password = 'Local-browser-test-42'
    let session = await api(page, '/auth/login', 'POST', { username, password })
    if (session.status === 401) session = await api(page, '/auth/register', 'POST', { username, password })
    assert.ok([200, 201].includes(session.status), `Test login: ${session.status}`)
    await api(page, '/me', 'PATCH', { displayName: `Тест ${role}` })
    const decks = await api(page, '/decks')
    let deck = decks.body.items.find(deck => deck.name === 'Gameplay fixture Безумный манекен')
    if (!deck) { const created = await api(page, '/decks', 'POST', { name: 'Gameplay fixture Безумный манекен', cards: fixtureDeck() }); assert.equal(created.status, 201); deck = created.body }
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Начать игру', exact: true }).click()
    await page.getByRole('button', { name: /^Онлайн-лобби/ }).click()
    const leave = page.getByRole('button', { name: 'Покинуть комнату', exact: true })
    if (await leave.isVisible()) await leave.click()
    await expect(page.getByRole('button', { name: 'Создать комнату', exact: true })).toBeEnabled()
    return { page, deck }
  }))
  const [owner, guest] = players.map(player => player.page)
  await owner.getByRole('button', { name: 'Создать комнату', exact: true }).click()
  const code = (await owner.getByRole('heading', { name: /^Комната / }).textContent()).match(/[A-Z0-9]{8}/)[0]
  await guest.getByLabel('Код приглашения').fill(code)
  await guest.getByRole('button', { name: 'Войти', exact: true }).click()
  for (const { page, deck } of players) {
    await page.getByRole('radio', { name: 'Колода ' + deck.name, exact: true }).check()
    await page.getByRole('button', { name: 'Готов', exact: true }).click()
  }
  await owner.getByRole('button', { name: 'Начать партию', exact: true }).click()
  for (const [index, page] of [owner, guest].entries()) {
    await expect(page.locator('.slot')).toHaveCount(25)
    for (const [width, height] of [[1280, 720], [1920, 1080], [390, 844]]) {
      await page.setViewportSize({ width, height })
      await layout(page, `online seat ${index}, ${width}×${height}`)
    }
    await page.setViewportSize({ width: 1280, height: 720 })
    await expect(page.locator('.player-profile.opponent')).toContainText(index ? 'Тест owner' : 'Тест guest')
    await expect(page.getByRole('heading', { name: 'Передайте устройство' })).toHaveCount(0)
  }
  const creature = page => page.locator('.hand-card:has(img[alt="Безумный манекен"])').first()
  await drag(owner, creature(owner), cell(owner, 4, 4), false, true)
  await expect(owner.locator('.slot.occupied')).toHaveCount(0)
  await drag(owner, creature(owner), cell(owner, 2, 4))
  await expect(owner.locator('.slot.occupied')).toHaveCount(0)
  await drag(owner, creature(owner), cell(owner, 4, 4))
  for (const page of [owner, guest]) await expect(cell(page, 4, 4).locator('.card-front')).toHaveCount(1)
  await finishTurn(owner)
  await expect(guest.locator('.end-turn')).toBeEnabled()
  await expect(owner.locator('.hand-card').first()).toBeDisabled()
  await expect(owner.locator('.battlefield')).not.toHaveClass(/p2/)
  await expect(guest.locator('.battlefield')).toHaveClass(/p2/)
  const home = await cell(guest, 0, 0).boundingBox(), enemy = await cell(guest, 4, 0).boundingBox()
  assert.ok(home.y > enemy.y, 'Guest should see their home row at the bottom')
  await drag(guest, creature(guest), cell(guest, 0, 2), true)
  for (const page of [owner, guest]) await expect(cell(page, 0, 2).locator('.card-front')).toHaveCount(1)
  await finishTurn(guest)
  await expect(owner.locator('.end-turn')).toBeEnabled()
  await drag(owner, cell(owner, 4, 4), cell(owner, 3, 4))
  await expect(cell(guest, 3, 4).locator('.card-front')).toHaveCount(1)
  await drag(owner, cell(owner, 3, 4), cell(owner, 2, 4))
  await expect(cell(guest, 2, 4).locator('.card-front')).toHaveCount(1)
  await finishTurn(owner)
  await expect(guest.locator('.end-turn')).toBeEnabled()
  await drag(guest, cell(guest, 0, 2), cell(guest, 1, 2), true)
  await expect(cell(owner, 1, 2).locator('.card-front')).toHaveCount(1)
  await finishTurn(guest)
  await expect(owner.locator('.end-turn')).toBeEnabled()
  await drag(owner, cell(owner, 2, 4), cell(owner, 1, 4))
  await expect(cell(guest, 1, 4).locator('.card-front')).toHaveCount(1)
  await drag(owner, cell(owner, 1, 4), cell(owner, 0, 4))
  await expect(cell(guest, 0, 4).locator('.card-front')).toHaveCount(1)
  await drag(owner, cell(owner, 0, 4), owner.locator('.player-profile.opponent'))
  await expect(guest.locator('.player-profile:not(.opponent) .profile-hp')).not.toContainText('45')
  await finishTurn(owner)
  await expect(guest.locator('.end-turn')).toBeEnabled()
  await drag(guest, cell(guest, 1, 2), cell(guest, 1, 3), true)
  await expect(cell(owner, 1, 3).locator('.card-front')).toHaveCount(1)
  await drag(guest, cell(guest, 1, 3), cell(guest, 0, 3), true)
  await expect(cell(owner, 0, 3).locator('.card-front')).toHaveCount(1)
  await drag(guest, cell(guest, 0, 3), cell(guest, 0, 4), true)
  for (const page of [owner, guest]) {
    await expect(cell(page, 0, 3).locator('.hp')).toHaveText('1')
    await expect(cell(page, 0, 4).locator('.hp')).toHaveText('1')
  }
  await owner.screenshot({ path: '.run/online-owner-fixed.png' })
  await guest.screenshot({ path: '.run/online-guest-fixed.png' })
  await guest.getByRole('button', { name: 'Сдаться', exact: true }).click()
  await expect(owner.getByRole('heading', { name: `Комната ${code}` })).toBeVisible()
  await owner.getByRole('button', { name: 'Покинуть комнату', exact: true }).click()
  console.log('Online drag play, both orientations, waiting lock, movement, unit combat, cancellation and direct attack passed in two independent accounts')
}
try {
  await local(false)
  await local(true)
  await online()
  assert.deepEqual(errors, [], 'Browser runtime errors')
  console.log('Gameplay browser checks passed')
} catch (error) {
  for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) {
    await page.screenshot({ path: `.run/gameplay-failure-${index}.png` }).catch(() => {})
    console.log('Failure UI:', (await page.locator('body').innerText()).slice(-1800))
  }
  throw error
} finally { await browser.close() }
