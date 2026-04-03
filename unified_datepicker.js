/**
 * UnifiedDatePicker — LAPIS3 共通カレンダーコンポーネント
 * image_6.png デザイン準拠 | 13pt フォント | 和暦併記
 * Flatpickr を完全に置き換える軽量な自作カレンダー
 * v2.0 — 直接イベントバインディング方式（イベント委譲の不具合を完全解消）
 */
(function () {
    'use strict';

    // --- 和暦変換 ---
    function toWareki(year) {
        if (year >= 2019) return '令和' + (year - 2018) + '年';
        if (year >= 1989) return '平成' + (year - 1988) + '年';
        if (year >= 1926) return '昭和' + (year - 1925) + '年';
        if (year >= 1912) return '大正' + (year - 1911) + '年';
        return '明治' + (year - 1867) + '年';
    }

    function daysInMonth(year, month) {
        return new Date(year, month + 1, 0).getDate();
    }

    function firstDayOfMonth(year, month) {
        return new Date(year, month, 1).getDay();
    }

    function formatISO(year, month, day) {
        var m = String(month + 1).padStart(2, '0');
        var d = String(day).padStart(2, '0');
        return year + '-' + m + '-' + d;
    }

    function formatDisplay(year, month, day) {
        var m = String(month + 1).padStart(2, '0');
        var d = String(day).padStart(2, '0');
        return year + '/' + m + '/' + d;
    }

    function parseDate(str) {
        if (!str) return null;
        var clean = str.replace(/\//g, '-');
        var parts = clean.split('-');
        if (parts.length !== 3) return null;
        var y = parseInt(parts[0], 10);
        var m = parseInt(parts[1], 10) - 1;
        var d = parseInt(parts[2], 10);
        if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
        return { year: y, month: m, day: d };
    }

    // ============================================================
    // UnifiedDatePicker Class
    // ============================================================
    function UnifiedDatePicker(inputEl, options) {
        this.input = inputEl;
        this.options = options || {};
        this.selectedDate = null;
        this.isOpen = false;

        var today = new Date();
        this.viewYear = today.getFullYear();
        this.viewMonth = today.getMonth();

        // Parse existing value
        if (inputEl.value) {
            var parsed = parseDate(inputEl.value);
            if (parsed) {
                this.selectedDate = parsed;
                this.viewYear = parsed.year;
                this.viewMonth = parsed.month;
            }
        }

        this._buildDOM();
        this._bindGlobalEvents();
        this._renderCalendar();
        this._updateDisplay();
    }

    // --- DOM Construction ---
    UnifiedDatePicker.prototype._buildDOM = function () {
        var self = this;

        // Wrapper
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'udp-wrapper';
        this.input.parentNode.insertBefore(this.wrapper, this.input);
        this.wrapper.appendChild(this.input);

        // Display input (visible)
        this.displayInput = document.createElement('input');
        this.displayInput.type = 'text';
        this.displayInput.className = 'udp-display-input ' + (this.input.className || '');
        this.displayInput.placeholder = this.input.placeholder || 'YYYY/MM/DD';
        this.displayInput.readOnly = false;
        this.displayInput.setAttribute('autocomplete', 'off');
        this.wrapper.appendChild(this.displayInput);

        // Hide original
        this.input.style.display = 'none';
        this.input.setAttribute('data-udp-initialized', 'true');

        // Calendar icon button
        this.iconBtn = document.createElement('button');
        this.iconBtn.type = 'button';
        this.iconBtn.className = 'udp-icon-btn';
        this.iconBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
        this.iconBtn.setAttribute('aria-label', 'カレンダーを開く');
        this.iconBtn.tabIndex = -1;
        this.wrapper.appendChild(this.iconBtn);

        // Wareki helper
        this.warekiHelper = document.createElement('div');
        this.warekiHelper.className = 'wareki-helper';
        this.wrapper.appendChild(this.warekiHelper);

        // Calendar popup
        this.popup = document.createElement('div');
        this.popup.className = 'udp-popup';
        this.popup.style.display = 'none';
        this.wrapper.appendChild(this.popup);
    };

    // --- Render Calendar + Bind Events (called every time view changes) ---
    UnifiedDatePicker.prototype._renderCalendar = function () {
        var self = this;
        var today = new Date();
        var todayY = today.getFullYear();
        var todayM = today.getMonth();
        var todayD = today.getDate();

        var y = this.viewYear;
        var m = this.viewMonth;
        var monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
        var dayNames = ['日', '月', '火', '水', '木', '金', '土'];

        // Build HTML
        var html = '';

        // ── Header ──
        html += '<div class="udp-header">';
        html += '  <div class="udp-year-select-wrap">';
        html += '    <select class="udp-year-select" aria-label="年の選択">';
        for (var yr = todayY - 20; yr <= todayY + 20; yr++) {
            var sel = (yr === y) ? ' selected' : '';
            html += '<option value="' + yr + '"' + sel + '>' + yr + '年(' + toWareki(yr) + ')</option>';
        }
        html += '    </select>';
        html += '  </div>';
        html += '  <div class="udp-month-nav">';
        html += '    <button type="button" class="udp-nav-btn udp-prev-month" aria-label="前月">&#8249;</button>';
        html += '    <span class="udp-month-label">' + monthNames[m] + '</span>';
        html += '    <button type="button" class="udp-nav-btn udp-next-month" aria-label="次月">&#8250;</button>';
        html += '  </div>';
        html += '</div>';

        // ── Weekday Headers ──
        html += '<div class="udp-weekdays">';
        for (var i = 0; i < dayNames.length; i++) {
            var wcls = 'udp-weekday';
            if (i === 0) wcls += ' udp-sunday';
            if (i === 6) wcls += ' udp-saturday';
            html += '<span class="' + wcls + '">' + dayNames[i] + '</span>';
        }
        html += '</div>';

        // ── Day Grid ──
        var firstDay = firstDayOfMonth(y, m);
        var totalDays = daysInMonth(y, m);

        html += '<div class="udp-days">';
        for (var e = 0; e < firstDay; e++) {
            html += '<span class="udp-day udp-empty"></span>';
        }
        for (var d = 1; d <= totalDays; d++) {
            var dayOfWeek = (firstDay + d - 1) % 7;
            var dcls = 'udp-day';
            if (dayOfWeek === 0) dcls += ' udp-sunday';
            if (dayOfWeek === 6) dcls += ' udp-saturday';
            if (y === todayY && m === todayM && d === todayD) dcls += ' udp-today';
            if (this.selectedDate && y === this.selectedDate.year && m === this.selectedDate.month && d === this.selectedDate.day) {
                dcls += ' udp-selected';
            }
            html += '<span class="' + dcls + '" data-day="' + d + '">' + d + '</span>';
        }
        html += '</div>';

        // ── Footer ──
        html += '<div class="udp-footer">';
        html += '  <button type="button" class="udp-clear-btn">削除</button>';
        html += '  <button type="button" class="udp-today-btn">今日</button>';
        html += '</div>';

        this.popup.innerHTML = html;

        // ══════════════════════════════════════════════════════════
        // DIRECT EVENT BINDING — bind to actual elements after render
        // ══════════════════════════════════════════════════════════

        // Year <select> — onChange
        var yearSelect = this.popup.querySelector('.udp-year-select');
        if (yearSelect) {
            yearSelect.addEventListener('change', function (e) {
                self.viewYear = parseInt(this.value, 10);
                self._renderCalendar();
            });
            // Also handle mousedown to prevent popup blur but allow native select
            yearSelect.addEventListener('mousedown', function (e) {
                e.stopPropagation(); // Don't let popup mousedown handler interfere
            });
        }

        // Prev month button — onClick
        var prevBtn = this.popup.querySelector('.udp-prev-month');
        if (prevBtn) {
            prevBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                self.viewMonth--;
                if (self.viewMonth < 0) {
                    self.viewMonth = 11;
                    self.viewYear--;
                }
                self._renderCalendar();
            });
        }

        // Next month button — onClick
        var nextBtn = this.popup.querySelector('.udp-next-month');
        if (nextBtn) {
            nextBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                self.viewMonth++;
                if (self.viewMonth > 11) {
                    self.viewMonth = 0;
                    self.viewYear++;
                }
                self._renderCalendar();
            });
        }

        // Day cells — onClick
        var dayCells = this.popup.querySelectorAll('.udp-day:not(.udp-empty)');
        for (var di = 0; di < dayCells.length; di++) {
            (function (cell) {
                cell.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    var day = parseInt(cell.getAttribute('data-day'), 10);
                    self.selectDate(self.viewYear, self.viewMonth, day);
                    self.close();
                });
            })(dayCells[di]);
        }

        // Clear button — onClick
        var clearBtn = this.popup.querySelector('.udp-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                self.clear();
                self.close();
            });
        }

        // Today button — onClick
        var todayBtn = this.popup.querySelector('.udp-today-btn');
        if (todayBtn) {
            todayBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var t = new Date();
                self.selectDate(t.getFullYear(), t.getMonth(), t.getDate());
                self.close();
            });
        }
    };

    // --- Global Events (bound once, not affected by re-render) ---
    UnifiedDatePicker.prototype._bindGlobalEvents = function () {
        var self = this;

        // Open on icon click
        this.iconBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            self.toggle();
        });

        // Open on display input focus
        this.displayInput.addEventListener('focus', function () {
            self.open();
        });

        // Manual input — Enter key
        this.displayInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                self._handleManualInput();
                self.close();
            }
            if (e.key === 'Escape') {
                self.close();
            }
        });

        // Manual input — blur
        this.displayInput.addEventListener('blur', function () {
            setTimeout(function () {
                if (!self.popup.contains(document.activeElement)) {
                    self._handleManualInput();
                }
            }, 250);
        });

        // Prevent blur when clicking inside popup (but NOT on <select>)
        this.popup.addEventListener('mousedown', function (e) {
            var tag = e.target.tagName;
            if (tag !== 'SELECT' && tag !== 'OPTION') {
                e.preventDefault();
            }
        });

        // Close on outside click
        document.addEventListener('click', function (e) {
            if (self.isOpen && !self.wrapper.contains(e.target)) {
                self.close();
            }
        });
    };

    // --- Selection ---
    UnifiedDatePicker.prototype.selectDate = function (year, month, day) {
        this.selectedDate = { year: year, month: month, day: day };
        this.viewYear = year;
        this.viewMonth = month;
        this._updateDisplay();
        this._renderCalendar();
        this.input.value = formatISO(year, month, day);
        this.input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    UnifiedDatePicker.prototype.clear = function () {
        this.selectedDate = null;
        this.displayInput.value = '';
        this.input.value = '';
        this.warekiHelper.textContent = '';
        this.input.dispatchEvent(new Event('change', { bubbles: true }));
        this._renderCalendar();
    };

    // --- Flatpickr compatibility: setDate ---
    UnifiedDatePicker.prototype.setDate = function (dateStr) {
        if (!dateStr) { this.clear(); return; }
        var parsed = parseDate(String(dateStr));
        if (parsed) {
            this.selectDate(parsed.year, parsed.month, parsed.day);
        }
    };

    // --- Manual Input ---
    UnifiedDatePicker.prototype._handleManualInput = function () {
        var val = this.displayInput.value.trim();
        if (!val) {
            if (this.selectedDate) this.clear();
            return;
        }
        // Normalize full-width digits to half-width
        var normalized = val.replace(/[０-９]/g, function (c) {
            return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
        });
        var parsed = parseDate(normalized);
        if (parsed && parsed.year >= 1900 && parsed.year <= 2100 &&
            parsed.month >= 0 && parsed.month <= 11 &&
            parsed.day >= 1 && parsed.day <= daysInMonth(parsed.year, parsed.month)) {
            this.selectDate(parsed.year, parsed.month, parsed.day);
        } else {
            this._updateDisplay();
        }
    };

    // --- Display Update ---
    UnifiedDatePicker.prototype._updateDisplay = function () {
        if (this.selectedDate) {
            var s = this.selectedDate;
            this.displayInput.value = formatDisplay(s.year, s.month, s.day);
            try {
                var date = new Date(s.year, s.month, s.day);
                var formatter = new Intl.DateTimeFormat('ja-JP-u-ca-japanese', {
                    era: 'long', year: 'numeric', month: 'long', day: 'numeric'
                });
                this.warekiHelper.textContent = '(' + formatter.format(date) + ')';
            } catch (e) {
                this.warekiHelper.textContent = '';
            }
        } else {
            this.displayInput.value = '';
            this.warekiHelper.textContent = '';
        }
    };

    // --- Open / Close / Toggle ---
    UnifiedDatePicker.prototype.open = function () {
        if (this.isOpen) return;
        if (this.selectedDate) {
            this.viewYear = this.selectedDate.year;
            this.viewMonth = this.selectedDate.month;
        }
        this._renderCalendar();
        this.popup.style.display = 'block';
        this.isOpen = true;
    };

    UnifiedDatePicker.prototype.close = function () {
        this.popup.style.display = 'none';
        this.isOpen = false;
    };

    UnifiedDatePicker.prototype.toggle = function () {
        if (this.isOpen) this.close(); else this.open();
    };

    // --- Flatpickr compatibility getter ---
    Object.defineProperty(UnifiedDatePicker.prototype, '_flatpickr', {
        get: function () { return this; }
    });

    // ============================================================
    // Auto-Initialize
    // ============================================================
    function initUnifiedDatePicker() {
        var dateInputs = document.querySelectorAll('input[type="date"], .lapis-datepicker');
        for (var i = 0; i < dateInputs.length; i++) {
            var input = dateInputs[i];
            if (input.getAttribute('data-udp-initialized')) continue;
            var picker = new UnifiedDatePicker(input);
            input._udp = picker;
            input._flatpickr = picker;
        }
    }

    // Export
    window.UnifiedDatePicker = UnifiedDatePicker;
    window.initUnifiedDatePicker = initUnifiedDatePicker;
})();
