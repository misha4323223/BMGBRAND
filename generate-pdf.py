from fpdf import FPDF

BLACK = (10, 10, 10)
WHITE = (245, 245, 240)
ACCENT = (200, 255, 0)
GRAY = (26, 26, 26)
GRAY2 = (42, 42, 42)
MUTED = (136, 136, 136)

W = 297
H = 210

FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
FONT_B = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

class Pitch(FPDF):
    def setup_fonts(self):
        self.add_font('R', '', FONT)
        self.add_font('R', 'B', FONT_B)

    def bg(self):
        self.set_fill_color(*BLACK)
        self.rect(0, 0, W, H, 'F')

    def label(self, text, y):
        self.set_xy(20, y)
        self.set_font('R', 'B', 7)
        self.set_text_color(*ACCENT)
        self.cell(0, 5, text.upper())

    def card(self, x, y, w, h):
        self.set_fill_color(*GRAY)
        self.set_draw_color(*GRAY2)
        self.rect(x, y, w, h, 'FD')

    def num_badge(self, n, total):
        self.set_xy(0, 8)
        self.set_font('R', '', 7)
        self.set_text_color(*MUTED)
        self.cell(W - 10, 5, f'{n:02d} / {total:02d}', align='R')

pdf = Pitch(orientation='L', unit='mm', format='A4')
pdf.set_auto_page_break(False)
pdf.set_margins(0, 0, 0)
pdf.setup_fonts()

T = 7  # total slides

# ── SLIDE 1: COVER ─────────────────────────────────────────────────────────
pdf.add_page(); pdf.bg(); pdf.num_badge(1, T)

pdf.set_font('R', '', 8); pdf.set_text_color(*MUTED)
pdf.set_xy(0, 58); pdf.cell(W, 6, 'Партнёрская программа  BOOOMERANGS', align='C')

pdf.set_font('R', 'B', 38); pdf.set_text_color(*WHITE)
pdf.set_xy(0, 70); pdf.cell(W, 16, 'Твоя коллекция.', align='C')
pdf.set_text_color(*ACCENT)
pdf.set_xy(0, 87); pdf.cell(W, 16, 'Твои деньги.', align='C')

pdf.set_font('R', '', 11); pdf.set_text_color(*MUTED)
pdf.set_xy(0, 112); pdf.cell(W, 6, 'Мы делаем вещи, которые носим сами — и хотим, чтобы ты был частью этого.', align='C')

pdf.set_draw_color(*ACCENT); pdf.set_fill_color(*BLACK)
pdf.rect(90, 128, 117, 11)
pdf.set_font('R', 'B', 7); pdf.set_text_color(*ACCENT)
pdf.set_xy(90, 131); pdf.cell(117, 5, 'ПАРТНЁРСКАЯ ПРОГРАММА ДЛЯ АРТИСТОВ И БРЕНДОВ', align='C')

# ── SLIDE 2: WHAT WE OFFER ─────────────────────────────────────────────────
pdf.add_page(); pdf.bg(); pdf.num_badge(2, T)
pdf.label('Что мы предлагаем', 14)

pdf.set_font('R', 'B', 22); pdf.set_text_color(*WHITE)
pdf.set_xy(20, 22); pdf.cell(0, 10, 'Не просто коллаб. Полноценное партнёрство.')

cards = [
    ('Твоя коллекция',    'Совместная линейка с твоим\nименем. Отдельный раздел\nв каталоге.'),
    ('Процент с продаж',  'Комиссия с каждой продажи\nсвоих товаров — автоматически,\nбез условий.'),
    ('Реферальная ссылка','Приводишь аудиторию —\nзарабатываешь процент со\nвсего, что они купят.'),
    ('Личная страница',   'Мини-сайт на нашем домене\nс твоим фото, видео\nи коллекцией.'),
    ('Личный кабинет',    'Продажи, клики, оборот\nи баланс в реальном\nвремени. Прозрачно.'),
    ('QR-код и виджет',   'QR для сторис и мерча,\nвиджет для вставки\nна свой сайт.'),
]
cw, ch, gap, sx, sy = 83, 50, 5, 20, 42
for i, (title, desc) in enumerate(cards):
    col, row = i % 3, i // 3
    cx, cy = sx + col*(cw+gap), sy + row*(ch+gap)
    pdf.card(cx, cy, cw, ch)
    pdf.set_font('R', 'B', 10); pdf.set_text_color(*WHITE)
    pdf.set_xy(cx+5, cy+8); pdf.cell(cw-10, 5, title)
    pdf.set_font('R', '', 8); pdf.set_text_color(*MUTED)
    for j, line in enumerate(desc.split('\n')):
        pdf.set_xy(cx+5, cy+17+j*5.5); pdf.cell(cw-10, 5, line)

# ── SLIDE 3: INCOME ────────────────────────────────────────────────────────
pdf.add_page(); pdf.bg(); pdf.num_badge(3, T)
pdf.label('Как ты зарабатываешь', 14)

pdf.set_font('R', 'B', 22); pdf.set_text_color(*WHITE)
pdf.set_xy(20, 22); pdf.cell(0, 10, 'Три источника дохода от одного партнёрства')

rows = [
    ('1','Продажи твоей коллекции',
     'Кто-то зашёл на сайт и купил твой товар — ты получаешь процент. Без ссылок, без условий.',
     '~25%','с каждой продажи'),
    ('2','Твои подписчики купили твой товар',
     'Пришли по твоей ссылке или промокоду — та же ставка, двойного начисления нет.',
     '~25%','та же ставка'),
    ('3','Твои подписчики купили что-то ещё',
     'Пришли по твоей ссылке, но взяли другие товары бренда — зарабатываешь и с них.',
     '~10%','с чужих товаров'),
]
sy = 40
for num, title, desc, pct, lbl in rows:
    pdf.card(20, sy, 257, 34)
    pdf.set_font('R', 'B', 24); pdf.set_text_color(*ACCENT)
    pdf.set_xy(26, sy+7); pdf.cell(14, 10, num)
    pdf.set_font('R', 'B', 10); pdf.set_text_color(*WHITE)
    pdf.set_xy(46, sy+6); pdf.cell(170, 5, title)
    pdf.set_font('R', '', 8); pdf.set_text_color(*MUTED)
    pdf.set_xy(46, sy+14); pdf.multi_cell(170, 5, desc)
    # ПРИМЕР badge
    pdf.set_fill_color(*ACCENT); pdf.rect(228, sy+4, 20, 5, 'F')
    pdf.set_font('R', 'B', 6); pdf.set_text_color(*BLACK)
    pdf.set_xy(228, sy+5.5); pdf.cell(20, 3.5, 'ПРИМЕР', align='C')
    # pct
    pdf.set_font('R', 'B', 18); pdf.set_text_color(*ACCENT)
    pdf.set_xy(224, sy+12); pdf.cell(30, 8, pct, align='C')
    pdf.set_font('R', '', 7); pdf.set_text_color(*MUTED)
    pdf.set_xy(224, sy+22); pdf.cell(30, 4, lbl, align='C')
    sy += 40

# ── SLIDE 4: ARTIST PAGE ───────────────────────────────────────────────────
pdf.add_page(); pdf.bg(); pdf.num_badge(4, T)
pdf.label('Твоя страница', 14)

pdf.set_font('R', 'B', 22); pdf.set_text_color(*WHITE)
pdf.set_xy(20, 22); pdf.cell(0, 10, 'Мини-сайт под твоим именем')
pdf.set_font('R', '', 9); pdf.set_text_color(*MUTED)
pdf.set_xy(20, 34); pdf.cell(0, 5, 'Полностью настраиваемая страница прямо на сайте Booomerangs')

cw, ch = 124, 88
for side, items, bx, title in [
    ('left',  ['Главное фото или видео (hero-баннер)','Текст о себе и своём проекте','Галерея работ и фото','Ссылки на соцсети','Вся коллекция с кнопкой «Купить»'], 20,  'ЧТО МОЖНО ДОБАВИТЬ'),
    ('right', ['Страница в Яндексе и Google','Все кнопки «Купить» с твоим реф-ID','Покупка с твоей страницы = твоя комиссия','Обновляешь через личный кабинет','Делишься ссылкой в сторис, bio, везде'], 153, 'КАК ЭТО РАБОТАЕТ'),
]:
    pdf.card(bx, 43, cw, ch)
    pdf.set_font('R', 'B', 7); pdf.set_text_color(*ACCENT)
    pdf.set_xy(bx+7, 50); pdf.cell(cw-14, 5, title)
    for i, item in enumerate(items):
        pdf.set_fill_color(*ACCENT); pdf.ellipse(bx+7, 60+i*11+2.5, 2.5, 2.5, 'F')
        pdf.set_font('R', '', 8.5); pdf.set_text_color(*WHITE)
        pdf.set_xy(bx+13, 59+i*11); pdf.cell(cw-20, 5, item)

pdf.set_fill_color(15, 30, 3); pdf.set_draw_color(*ACCENT)
pdf.rect(20, 137, 257, 13, 'FD')
pdf.set_font('R', 'B', 11); pdf.set_text_color(*ACCENT)
pdf.set_xy(20, 140); pdf.cell(257, 6, 'booomerangs.ru / @ твой-ник', align='C')

# ── SLIDE 5: PAYOUTS ───────────────────────────────────────────────────────
pdf.add_page(); pdf.bg(); pdf.num_badge(5, T)
pdf.label('Выплаты', 14)

pdf.set_font('R', 'B', 22); pdf.set_text_color(*WHITE)
pdf.set_xy(20, 22); pdf.cell(0, 10, 'Как приходят деньги')

steps = [
    ('Продажа',       'Покупатель\nоплатил заказ',        None),
    ('Холд',          '14 дней\n(период возврата)',        '14 ДНЕЙ'),
    ('Подтверждено',  'Сумма доступна\nк выводу',          None),
    ('Документы',     'Чек самозанятого\nили акт для ИП', None),
    ('Выплата',       'Деньги на\nтвоей карте',            'ГОТОВО'),
]
sw, sh, gap, sx, sy = 46, 58, 5, 20, 40
for i, (title, desc, badge) in enumerate(steps):
    cx = sx + i*(sw+gap)
    pdf.card(cx, sy, sw, sh)
    pdf.set_font('R', 'B', 9); pdf.set_text_color(*WHITE)
    pdf.set_xy(cx, sy+10); pdf.cell(sw, 5, title, align='C')
    pdf.set_font('R', '', 7.5); pdf.set_text_color(*MUTED)
    for j, line in enumerate(desc.split('\n')):
        pdf.set_xy(cx, sy+19+j*5); pdf.cell(sw, 4.5, line, align='C')
    if badge:
        pdf.set_fill_color(15, 30, 3); pdf.set_draw_color(*ACCENT)
        pdf.rect(cx+4, sy+33, sw-8, 7, 'FD')
        pdf.set_font('R', 'B', 6); pdf.set_text_color(*ACCENT)
        pdf.set_xy(cx+4, sy+35); pdf.cell(sw-8, 4, badge, align='C')
    if i < len(steps)-1:
        pdf.set_font('R', '', 10); pdf.set_text_color(*MUTED)
        pdf.set_xy(cx+sw, sy+24); pdf.cell(gap+1, 5, '>', align='C')

pdf.set_font('R', '', 9); pdf.set_text_color(*MUTED)
pdf.set_xy(20, 106); pdf.cell(257, 6, 'Работаем официально — самозанятые, ИП, ООО. Каждый заказ виден в твоём кабинете.', align='C')

# ── SLIDE 6: WHO ───────────────────────────────────────────────────────────
pdf.add_page(); pdf.bg(); pdf.num_badge(6, T)
pdf.label('Кому это подходит', 14)

pdf.set_font('R', 'B', 26); pdf.set_text_color(*WHITE)
pdf.set_xy(20, 22); pdf.cell(0, 12, 'Ищем своих людей')

who = [
    ('Музыканты',      'Хочешь мерч —\nделаем вместе.'),
    ('Художники',      'Твои принты и графика —\nна реальных вещах.'),
    ('Блогеры',        'Своя аудитория?\nМонетизируй без\nсвоего производства.'),
    ('Бренды / проекты','Коллектив, субкультура —\nколлаб под твой проект.'),
]
cw, ch, gap, sx, sy = 59, 65, 6, 20, 44
for i, (title, desc) in enumerate(who):
    cx = sx + i*(cw+gap)
    pdf.card(cx, sy, cw, ch)
    pdf.set_font('R', 'B', 10); pdf.set_text_color(*WHITE)
    pdf.set_xy(cx, sy+22); pdf.cell(cw, 5, title, align='C')
    pdf.set_font('R', '', 8); pdf.set_text_color(*MUTED)
    for j, line in enumerate(desc.split('\n')):
        pdf.set_xy(cx, sy+30+j*6); pdf.cell(cw, 5, line, align='C')

pdf.set_fill_color(*ACCENT); pdf.rect(70, 118, 157, 12, 'F')
pdf.set_font('R', 'B', 8); pdf.set_text_color(*BLACK)
pdf.set_xy(70, 121); pdf.cell(157, 6, 'ГЛАВНОЕ — РАЗДЕЛЯТЬ ЦЕННОСТИ БРЕНДА', align='C')

# ── SLIDE 7: FINAL CTA ─────────────────────────────────────────────────────
pdf.add_page(); pdf.bg(); pdf.num_badge(7, T)

pdf.set_font('R', 'B', 34); pdf.set_text_color(*WHITE)
pdf.set_xy(0, 38); pdf.cell(W, 13, 'Давай сделаем', align='C')
pdf.set_text_color(*ACCENT)
pdf.set_xy(0, 53); pdf.cell(W, 13, 'что-то крутое', align='C')
pdf.set_text_color(*WHITE)
pdf.set_xy(0, 68); pdf.cell(W, 13, 'вместе', align='C')

pdf.set_font('R', '', 10); pdf.set_text_color(*MUTED)
pdf.set_xy(0, 91); pdf.cell(W, 6, 'Заполни заявку на сайте — мы свяжемся, обсудим условия и запустим твою коллекцию.', align='C')

pdf.set_fill_color(*ACCENT); pdf.rect(87, 108, 58, 12, 'F')
pdf.set_font('R', 'B', 8); pdf.set_text_color(*BLACK)
pdf.set_xy(87, 111); pdf.cell(58, 5, 'ПОДАТЬ ЗАЯВКУ', align='C')

pdf.set_fill_color(*BLACK); pdf.set_draw_color(70, 70, 70)
pdf.rect(151, 108, 58, 12, 'FD')
pdf.set_font('R', 'B', 8); pdf.set_text_color(*WHITE)
pdf.set_xy(151, 111); pdf.cell(58, 5, 'BOOOMERANGS.RU', align='C')

pdf.set_font('R', '', 7); pdf.set_text_color(45, 45, 45)
pdf.set_xy(0, 188); pdf.cell(W, 5, 'BOOOMERANGS — Делаем вещи, которые носим сами', align='C')

pdf.output('artist-pitch.pdf')
print('PDF готов: artist-pitch.pdf')
