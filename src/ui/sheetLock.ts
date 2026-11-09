// Пока открыта шторка снизу, страница под ней не должна реагировать на касания: не прокручиваться и не
// передавать жесты плану (перетаскивание колонок, касание карты). Блокируем прокрутку страницы и гасим
// движение пальца по затемнению; внутри шторки длинный текст прокручивается, но не «перетекает» на страницу.
import type { RefObject } from 'preact';
import { useEffect } from 'preact/hooks';

let locks = 0;
let savedY = 0;

function lock() {
  if (locks++ > 0) return;
  savedY = window.scrollY;
  const b = document.body.style;
  b.position = 'fixed';
  b.top = `-${savedY}px`;
  b.left = '0';
  b.right = '0';
  b.width = '100%';
  b.overflow = 'hidden';
}

function unlock() {
  if (--locks > 0) return;
  const b = document.body.style;
  b.position = '';
  b.top = '';
  b.left = '';
  b.right = '';
  b.width = '';
  b.overflow = '';
  window.scrollTo(0, savedY);
}

/**
 * Захват касаний шторкой: backdrop — затемнение на весь экран, sheet — сама шторка.
 * Движение пальца разрешено только внутри шторки, когда ей есть куда прокручиваться.
 */
export function useSheetLock(backdrop: RefObject<HTMLElement | null>, sheet: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    if (!active) return;
    lock();
    const bd = backdrop.current;
    let startY = 0;
    const onStart = (e: TouchEvent) => { startY = e.touches[0]?.clientY ?? 0; };
    const onMove = (e: TouchEvent) => {
      const s = sheet.current;
      if (!s || !s.contains(e.target as Node)) { e.preventDefault(); return; }
      const dy = (e.touches[0]?.clientY ?? 0) - startY;
      const atTop = s.scrollTop <= 0, atEnd = s.scrollTop + s.clientHeight >= s.scrollHeight - 1;
      // в шторке нечего прокручивать или упёрлись в край — не отдаём жест странице
      if (s.scrollHeight <= s.clientHeight || (dy > 0 && atTop) || (dy < 0 && atEnd)) e.preventDefault();
    };
    bd?.addEventListener('touchstart', onStart, { passive: true });
    bd?.addEventListener('touchmove', onMove, { passive: false });
    return () => {
      bd?.removeEventListener('touchstart', onStart);
      bd?.removeEventListener('touchmove', onMove);
      unlock();
    };
  }, [active, backdrop, sheet]);
}
