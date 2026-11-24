import type { OverviewVM } from '@/lib/view-models/overview';
import { C } from '@/lib/design/tokens';
import { WeatherKpiPills } from '../dashboard/WeatherKpiPills';
import { OnOffToggle } from '../ui/OnOffToggle';
import { IconBellSimple, IconBuildingSimple, IconMessage } from '../ui/icons';
import { MobileWarningSummary } from './MobileWarningSummary';
import styles from './mobile.module.css';

export function MobileKPIs({ vm, alertsHref }: { vm: OverviewVM; alertsHref: string }) {
  const k = vm.kpi;
  const a = vm.avail;

  return (
    <>
      <div className={styles.overviewStats}>
        <div className={styles.overviewStat}>
          <div className={styles.statContent}>
            <span className={styles.kpiIcon} style={{ background: C.chip, color: C.ink }}><IconBuildingSimple size={14} /></span>
            <strong>{k.total}</strong>
          </div>
          <div className={styles.weatherLabel}>Fastigheter</div>
        </div>
        <div className={styles.overviewStat}>
          <div className={styles.statContent}>
            <span className={styles.kpiIcon} style={{ background: 'oklch(.95 .035 30)', color: 'oklch(.56 .17 28)' }}><IconBellSimple size={14} /></span>
            <strong>{a.alerts ? k.alerts : '—'}</strong>
          </div>
          <div className={styles.weatherLabel}>Aktiva larm</div>
        </div>
        <div className={styles.overviewStat}>
          <div className={styles.statContent}>
            <span className={styles.kpiIcon} style={{ background: 'oklch(.95 .035 155)', color: 'oklch(.52 .12 155)' }}><IconMessage size={14} /></span>
            <span role="img" aria-label={k.smsOn ? 'SMS-larm aktiverat' : 'SMS-larm inte aktiverat'} className={styles.smsStatus}>
              <OnOffToggle on={k.smsOn} width={26} />
            </span>
          </div>
          <div className={styles.weatherLabel}>SMS-larm</div>
        </div>
        <div className={`${styles.overviewStat} ${styles.overviewWeather}`}>
          <div className={`${styles.statContent} ${styles.statWeatherHeading}`}>
            <strong>{a.weather ? k.wx : '—'}</strong>
            <span className={styles.weatherLabel}>Väderhändelser</span>
          </div>
          <div className={styles.statWeatherPills}><WeatherKpiPills split={k.wxSplit} available={a.weather} pillClassName={styles.chip} /></div>
        </div>
      </div>
      <MobileWarningSummary vm={vm} alertsHref={alertsHref} />
    </>
  );
}
