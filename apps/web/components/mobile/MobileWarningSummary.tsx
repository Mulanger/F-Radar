'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { WL } from '@/lib/design/tokens';
import type { OverviewVM } from '@/lib/view-models/overview';
import { IconAlert, IconChevronDown, IconChevronRight } from '../ui/icons';
import { Popover } from '../ui/Popover';
import styles from './mobile.module.css';

export function MobileWarningSummary({ vm, alertsHref }: { vm: OverviewVM; alertsHref: string }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState({ above: false, listHeight: 228 });
  const [scrollable, setScrollable] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const scope = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  const available = vm.avail.warnings;
  const warnings = vm.warningPreview;
  const highest = available ? warnings[0] : undefined;
  const n = available ? warnings.length : 0;
  const visible = open && n > 0;
  const vmas = warnings.filter((warning) => warning.level === 'VMA').length;
  const other = n - vmas;
  const vmaLabel = vmas === 1 && other > 0 ? 'VMA' : `${vmas} VMA`;

  let title = 'Officiella varningar';
  if (available && !highest) title = 'Inga officiella varningar';
  if (highest) {
    if (vmas > 0) {
      title = other === 0 ? vmaLabel : `${vmaLabel} och ${other} ${other === 1 ? 'annan varning' : 'andra varningar'}`;
    } else {
      title = n === 1 ? `1 ${WL[highest.level].label.toLocaleLowerCase('sv')} varning` : `${n} officiella varningar`;
    }
  }

  useLayoutEffect(() => {
    if (!open) return;
    const updatePlacement = () => {
      const bounds = trigger.current?.getBoundingClientRect();
      if (!bounds || bounds.bottom <= 0 || bounds.top >= window.innerHeight) {
        setOpen(false);
        return;
      }
      const roomAbove = bounds.top - 16;
      const roomBelow = window.innerHeight - bounds.bottom - 88;
      const preferredHeight = Math.min(n * 53 + 47, 288);
      const above = roomBelow < preferredHeight && roomAbove > roomBelow;
      const room = above ? roomAbove : roomBelow;
      setPlacement({ above, listHeight: Math.max(46, Math.floor(room - 47)) });
    };
    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, { passive: true });
    return () => {
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement);
    };
  }, [open, n]);

  function measureScroll() {
    const el = list.current;
    if (!el) return;
    setScrollable(el.scrollHeight > el.clientHeight + 1);
    setHasMore(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  }

  useLayoutEffect(() => {
    if (visible) measureScroll();
  }, [visible, placement.listHeight, warnings]);

  function close() {
    if (scope.current?.contains(document.activeElement)) trigger.current?.focus();
    setOpen(false);
  }

  const affected = vm.kpi.warnAffected;
  const content = <>
    <span className={styles.warningIcon}><IconAlert size={16} /></span>
    <span className={styles.warningCopy}>
      <strong>{title}</strong>
      {highest && <span>Berör {affected} {affected === 1 ? 'fastighet' : 'fastigheter'}</span>}
      {!available && <span>Ej ansluten</span>}
    </span>
  </>;

  return (
    <div className={styles.warningWrap} ref={scope}>
      {highest ? (
        <button type="button" ref={trigger} onClick={() => setOpen((value) => !value)} className={styles.warningSummary} data-level={highest.level} aria-expanded={visible} aria-controls={visible ? listId : undefined}>
          {content}
          <span className={styles.warningAction}>Visa varningar <IconChevronDown size={13} /></span>
        </button>
      ) : (
        <Link href={alertsHref} className={styles.warningSummary}>
          {content}
          <span className={styles.warningAction}>Visa larm <IconChevronRight size={13} /></span>
        </Link>
      )}
      <Popover open={visible} onClose={close} style={{ insetInline: 0, [placement.above ? 'bottom' : 'top']: 'calc(100% + 6px)', padding: 0, background: '#fff' }}>
        <section id={listId} aria-label="Officiella varningar" className={styles.warningPreview}>
          <div className={`${styles.scrollWrap} ${hasMore ? styles.scrollFade : ''}`}>
            <ul ref={list} className={styles.warningList} style={{ maxHeight: `min(228px, 38dvh, ${placement.listHeight}px)` }} onScroll={measureScroll}
              tabIndex={scrollable ? 0 : undefined} aria-label={scrollable ? `${n} varningar – scrolla för fler` : undefined}>
              {warnings.map((warning) => (
                <li key={warning.id} className={styles.warningRow}>
                  <div>
                    <strong>{warning.title}</strong>
                    <span className={styles.warningRowDetail}>
                      {warning.level !== 'VMA' && `${WL[warning.level].label} varning · `}
                      {warning.region || `${warning.affected} ${warning.affected === 1 ? 'fastighet' : 'fastigheter'}`}
                    </span>
                  </div>
                  <span aria-hidden="true" className={styles.warningSquare} data-level={warning.level} />
                </li>
              ))}
            </ul>
          </div>
          <Link href={alertsHref} onClick={() => setOpen(false)} className={styles.warningFooter}>
            Gå till Larm <IconChevronRight size={14} />
          </Link>
        </section>
      </Popover>
    </div>
  );
}
