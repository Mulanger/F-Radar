'use client';

import { useEffect, useRef, useState } from 'react';
import type { OverviewVM } from '@/lib/view-models/overview';
import { useDashboard } from '@/lib/state/dashboard-state';
import { PortfolioMap } from '../maps/PortfolioMap';
import { IconClose } from '../ui/icons';
import { MobileSection } from './MobilePrimitives';
import styles from './mobile.module.css';

export function MobilePortfolioMap({ vm }: { vm: OverviewVM }) {
  const ds = useDashboard();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialogRef.current?.showModal();
    else if (dialogRef.current?.open) dialogRef.current.close();
  }, [open]);
  const shared = { list: vm.list, legend: vm.legend, layers: ds.layers, onToggleLayer: ds.toggleLayer, onOpen: ds.openProperty };
  return <MobileSection title="Portföljkarta" subtitle={ds.mode === 'demo' ? 'Adresspunkter · illustrerade lager i demo' : 'Adresspunkter för dina fastigheter'}>
    <PortfolioMap {...shared} compact />
    <button className={styles.more} style={{ background: '#fff', border: '1px solid rgba(20,23,26,.08)' }} onClick={() => setOpen(true)}>Öppna kartvy ↗</button>
    <dialog ref={dialogRef} className={styles.mapDialog} aria-labelledby="mobile-map-title" onCancel={() => setOpen(false)} onClose={() => setOpen(false)}>
      <div className={styles.dialogHeader}><h2 className={styles.sectionTitle} id="mobile-map-title">Portföljkarta</h2><button className={styles.iconButton} onClick={() => setOpen(false)} aria-label="Stäng kartvy"><IconClose /></button></div>
      {open && <PortfolioMap {...shared} mobileControls onOpen={(id) => { setOpen(false); ds.openProperty(id); }} />}
      <p className={styles.sectionSub}>Tryck på en nål för att öppna fastigheten, eller på en siffra för att zooma in där flera ligger nära varandra. {ds.mode === 'live' ? 'Regn- och översvämningslager visas när geografiska källor finns tillgängliga.' : 'Regn- och vattenområden är illustrerade demodata.'}</p>
    </dialog>
  </MobileSection>;
}
