/**
 * UnifiedMonthPicker — LAPIS3 月選択カレンダーコンポーネント
 * image_6.png デザイン準拠 | 13pt フォント | 和暦併記
 * 年プルダウン + 3×4 月グリッド + 削除/今月ボタン
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

    // ============================================================
    // UnifiedMonthPicker Class
    // ============================================================
    function UnifiedMonthPicker(inputEl, options) {
        this.input = inputEl;
        this.options = options || {};
        this.selectedYear = null;
        this.selectedMonth = null; // 0-indexed (0=Jan, 11=Dec)
        this.isOpen = false;

        var today = new Date();
        this.viewYear = today.getFullYear();

        // Parse existing value (YYYY-MM)
        if (inputEl.value) {
            var parts = inputEl.value.split('-');
            if (parts.length >= 2) {
                this.selectedYear = parseInt(parts[0], 10);
                this.selectedMonth = parseInt(parts[1], 10) - 1;
                this.viewYear = this.selectedYear;
            }
        }

        this._buildDOM();
        this._bindGlobalEvents();
        this._renderCalendar();
        this._updateDisplay();
    }

    // --- DOM Construction ---
    UnifiedMonthPicker.prototype._buildDOM = function () {
        // Wrapper
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'udp-wrapper';
        this.input.parentNode.insertBefore(this.wrapper, this.input);
        this.wrapper.appendChild(this.input);

        // Display input (visible)
        this.displayInput = document.createElement('input');
        this.displayInput.type = 'text';
        this.displayInput.className = 'udp-display-input ' + (this.input.className || '');
        this.displayInput.placeholder = this.input.placeholder || '-----年--月';
        this.displayInput.readOnly = true;
        this.displayInput.setAttribute('autocomplete', 'off');
        this.wrapper.appendChild(this.displayInput);

        // Hide original
        this.input.style.display = 'none';
        this.input.setAttribute('data-ump-initialized', 'true');

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
        this.popup.className = 'udp-popup ump-popup';
        this.popup.style.display = 'none';
        this.wrapper.appendChild(this.popup);
    };

    // --- Render Calendar + Bind Events ---
    UnifiedMonthPicker.prototype._renderCalendar = function () {
        var self = this;
        var today = new Date();
        var todayY = today.getFullYear();
        var todayM = today.getMonth();
        var y = this.viewYear;
        var monthLabels = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

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
        html += '    <button type="button" class="udp-nav-btn ump-prev-year" aria-label="前年">&#8249;</button>';
        html += '    <span class="udp-month-label">' + y + '年</span>';
        html += '    <button type="button" class="udp-nav-btn ump-next-year" aria-label="次年">&#8250;</button>';
        html += '  </div>';
        html += '</div>';

        // ── Month Grid (3×4) ──
        html += '<div class="ump-months">';
        for (var m = 0; m < 12; m++) {
            var cls = 'ump-month';
            // Today's month
            if (y === todayY && m === todayM) {
                cls += ' ump-current';
            }
            // Selected
            if (this.selectedYear === y && this.selectedMonth === m) {
                cls += ' ump-selected';
            }
            html += '<span class="' + cls + '" data-month="' + m + '">' + monthLabels[m] + '</span>';
        }
        html += '</div>';

        // ── Footer ──
        html += '<div class="udp-footer">';
        html += '  <button type="button" class="udp-clear-btn">削除</button>';
        html += '  <button type="button" class="udp-today-btn">今月</button>';
        html += '</div>';

        this.popup.innerHTML = html;

        // ══════════════════════════════════════════════════
        // DIRECT EVENT BINDING
        // ══════════════════════════════════════════════════

        // Year <select>
        var yearSelect = this.popup.querySelector('.udp-year-select');
        if (yearSelect) {
            yearSelect.addEventListener('change', function () {
                self.viewYear = parseInt(this.value, 10);
                self._renderCalendar();
            });
            yearSelect.addEventListener('mousedown', function (e) {
                e.stopPropagation();
            });
        }

        // Prev year
        var prevBtn = this.popup.querySelector('.ump-prev-year');
        if (prevBtn) {
            prevBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                self.viewYear--;
                self._renderCalendar();
            });
        }

        // Next year
        var nextBtn = this.popup.querySelector('.ump-next-year');
        if (nextBtn) {
            nextBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                self.viewYear++;
                self._renderCalendar();
            });
        }

        // Month cells
        var monthCells = this.popup.querySelectorAll('.ump-month');
        for (var i = 0; i < monthCells.length; i++) {
            (function (cell) {
                cell.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    var month = parseInt(cell.getAttribute('data-month'), 10);
                    self.selectMonth(self.viewYear, month);
                    self.close();
                });
            })(monthCells[i]);
        }

        // Clear
        var clearBtn = this.popup.querySelector('.udp-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                self.clear();
                self.close();
            });
        }

        // Today (this month)
        var todayBtn = this.popup.querySelector('.udp-today-btn');
        if (todayBtn) {
            todayBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var t = new Date();
                self.selectMonth(t.getFullYear(), t.getMonth());
                self.close();
            });
        }
    };

    // --- Global Events ---
    UnifiedMonthPicker.prototype._bindGlobalEvents = function () {
        var self = this;

        this.iconBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            self.toggle();
        });

        this.displayInput.addEventListener('click', function () {
            self.toggle();
        });

        this.displayInput.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') self.close();
        });

        // Prevent blur
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
    UnifiedMonthPicker.prototype.selectMonth = function (year, month) {
        this.selectedYear = year;
        this.selectedMonth = month;
        this.viewYear = year;
        this._updateDisplay();
        this._renderCalendar();
        // Store as YYYY-MM in hidden input
        var m = String(month + 1).padStart(2, '0');
        this.input.value = year + '-' + m;
        this.input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    UnifiedMonthPicker.prototype.clear = function () {
        this.selectedYear = null;
        this.selectedMonth = null;
        this.displayInput.value = '';
        this.input.value = '';
        this.warekiHelper.textContent = '';
        this.input.dispatchEvent(new Event('change', { bubbles: true }));
        this._renderCalendar();
    };

    // Flatpickr compatibility
    UnifiedMonthPicker.prototype.setDate = function (dateStr) {
        if (!dateStr) { this.clear(); return; }
        var parts = String(dateStr).split('-');
        if (parts.length >= 2) {
            this.selectMonth(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1);
        }
    };

    // --- Display ---
    UnifiedMonthPicker.prototype._updateDisplay = function () {
        if (this.selectedYear !== null && this.selectedMonth !== null) {
            var m = String(this.selectedMonth + 1).padStart(2, '0');
            this.displayInput.value = this.selectedYear + '年' + m + '月';
            this.warekiHelper.textContent = '(' + toWareki(this.selectedYear) + m + '月)';
        } else {
            this.displayInput.value = '';
            this.warekiHelper.textContent = '';
        }
    };

    // --- Open / Close ---
    UnifiedMonthPicker.prototype.open = function () {
        if (this.isOpen) return;
        if (this.selectedYear !== null) this.viewYear = this.selectedYear;
        this._renderCalendar();
        this.popup.style.display = 'block';
        this.isOpen = true;
    };

    UnifiedMonthPicker.prototype.close = function () {
        this.popup.style.display = 'none';
        this.isOpen = false;
    };

    UnifiedMonthPicker.prototype.toggle = function () {
        if (this.isOpen) this.close(); else this.open();
    };

    Object.defineProperty(UnifiedMonthPicker.prototype, '_flatpickr', {
        get: function () { return this; }
    });

    // ============================================================
    // Auto-Initialize
    // ============================================================
    function initUnifiedMonthPicker() {
        var monthInputs = document.querySelectorAll('input[type="month"], .lapis-monthpicker');
        for (var i = 0; i < monthInputs.length; i++) {
            var input = monthInputs[i];
            if (input.getAttribute('data-ump-initialized')) continue;
            var picker = new UnifiedMonthPicker(input);
            input._ump = picker;
            input._flatpickr = picker;
        }
    }

    window.UnifiedMonthPicker = UnifiedMonthPicker;
    window.initUnifiedMonthPicker = initUnifiedMonthPicker;
})();
