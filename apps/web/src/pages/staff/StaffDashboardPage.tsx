import { useState } from 'react';
import { dashboardQuerySchema } from '@b2c/shared';
import { format, useI18n } from '../../i18n';
import { formatDateTime, formatMoney, formatNumber } from '../../lib/format';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FormMessage, TextField } from '../../components/ui/Fields';
import { useDashboard, type Dashboard } from '../delivery/queries';
import { useCan } from './queries';

function Stat({ label, value, testId }: { label: string; value: string | number; testId?: string }) {
  return (
    <div className="card" style={{ margin: 0 }}>
      <p className="muted" style={{ margin: 0 }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: '1.7rem', fontWeight: 800 }} data-testid={testId}>{value}</p>
    </div>
  );
}

const grid = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' } as const;

function Money({ rows, emptyText }: { rows: { currency: string; amount: string; count?: number }[]; emptyText: string }) {
  const { lang } = useI18n();
  if (rows.length === 0) return <p className="muted" style={{ margin: '4px 0 0' }}>{emptyText}</p>;
  return (
    <ul className="list-plain" style={{ gap: 2, margin: '4px 0 0' }}>
      {rows.map((r) => (
        <li key={r.currency} style={{ fontWeight: 800, fontSize: '1.3rem' }}>
          {formatMoney(r.amount, r.currency, lang)}
          {r.count !== undefined ? <span className="muted" style={{ fontSize: '0.9rem', fontWeight: 500 }}> · {r.count}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function Report({ data }: { data: Dashboard }) {
  const { m, lang } = useI18n();
  const d = m.delivery.staff.dashboard;
  const none = d.none;
  const hours = (value: number | null) => (value === null ? d.noMeasure : format(d.hours, { n: formatNumber(value, lang, 1) }));

  return (
    <div className="stack" data-testid="dashboard">
      <p className="muted">
        {format(d.period, { from: data.range.from, to: data.range.to })} · {format(d.generated, { date: formatDateTime(data.generatedAt, lang) })}
      </p>

      <section aria-labelledby="dash-packages">
        <h2 id="dash-packages" style={{ fontSize: '1.3rem' }}>{d.packages}</h2>
        <div style={grid}>
          <Stat label={d.customers} value={data.customers.total} testId="dash-customers" />
          <Stat label={d.newCustomers} value={data.customers.newInRange} />
          <Stat label={d.received} value={data.packages.receivedInRange} testId="dash-received" />
          <Stat label={d.inTransit} value={data.packages.inTransit} />
          <Stat label={d.awaitingPayment} value={data.packages.awaitingPayment} />
          <Stat label={d.toDeliver} value={data.packages.toDeliver} />
          <Stat label={d.delivered} value={data.packages.deliveredInRange} testId="dash-delivered" />
          <Stat label={d.onHold} value={data.packages.onHold} />
        </div>
      </section>

      <section aria-labelledby="dash-shipments">
        <h2 id="dash-shipments" style={{ fontSize: '1.3rem' }}>{d.shipments}</h2>
        {data.shipments.byMode.length === 0 ? (
          <p className="muted">{none}</p>
        ) : (
          <div style={grid}>
            {data.shipments.byMode.map((row) => (
              <Stat key={row.mode} label={m.staff.common.modes[row.mode]} value={row.count} />
            ))}
          </div>
        )}
        <h3 style={{ fontSize: '1.05rem', marginTop: 16 }}>{d.warehouses}</h3>
        {data.warehouses.length === 0 ? (
          <p className="muted">{none}</p>
        ) : (
          <table className="table" aria-label={d.warehouses}>
            <thead>
              <tr>
                <th scope="col">{d.warehouse}</th>
                <th scope="col" className="num">{d.atWarehouse}</th>
                <th scope="col" className="num">{d.receivedPeriod}</th>
              </tr>
            </thead>
            <tbody>
              {data.warehouses.map((w) => (
                <tr key={w.id}>
                  <th scope="row">{w.name} ({w.city})</th>
                  <td className="num">{w.atWarehouse}</td>
                  <td className="num">{w.receivedInRange}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="dash-finance">
        <h2 id="dash-finance" style={{ fontSize: '1.3rem' }}>{d.finance}</h2>
        <div style={grid}>
          <div className="card" style={{ margin: 0 }}>
            <p className="muted" style={{ margin: 0 }}>{d.collected}</p>
            <Money rows={data.finance.collected} emptyText={none} />
          </div>
          <div className="card" style={{ margin: 0 }}>
            <p className="muted" style={{ margin: 0 }}>{d.refunded}</p>
            <Money rows={data.finance.refunded} emptyText={none} />
          </div>
          <div className="card" style={{ margin: 0 }}>
            <p className="muted" style={{ margin: 0 }}>{d.invoiced}</p>
            <Money rows={data.finance.invoiced} emptyText={none} />
          </div>
          <div className="card" style={{ margin: 0 }}>
            <p className="muted" style={{ margin: 0 }}>{d.unpaid}</p>
            <Money rows={data.finance.unpaid} emptyText={none} />
          </div>
        </div>
      </section>

      <section aria-labelledby="dash-incidents">
        <h2 id="dash-incidents" style={{ fontSize: '1.3rem' }}>{d.incidents}</h2>
        <div style={grid}>
          <Stat label={d.openHolds} value={data.incidents.openHolds} />
          <Stat label={d.claimsOpen} value={data.incidents.claimsOpenInProgress} testId="dash-claims-open" />
          <Stat label={d.claimsResolved} value={data.incidents.claimsByStatus.RESOLVED} />
          <Stat label={d.claimsRejected} value={data.incidents.claimsByStatus.REJECTED} />
          <Stat label={d.claimsPeriod} value={data.incidents.claimsOpenedInRange} />
        </div>
      </section>

      <section aria-labelledby="dash-delays">
        <h2 id="dash-delays" style={{ fontSize: '1.3rem' }}>{d.delays}</h2>
        <table className="table" aria-label={d.delays}>
          <thead>
            <tr>
              <th scope="col">{d.stage}</th>
              <th scope="col" className="num">{d.measured}</th>
              <th scope="col" className="num">{d.average}</th>
            </tr>
          </thead>
          <tbody>
            {(['warehouseReceiptToReady', 'transport', 'agencyReceiptToDelivered'] as const).map((key) => (
              <tr key={key}>
                <th scope="row">{d.delayLabels[key]}</th>
                <td className="num">{data.delays[key].count}</td>
                <td className="num">{hours(data.delays[key].avgHours)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">{d.delaysNote}</p>
      </section>

      <section aria-labelledby="dash-performance">
        <h2 id="dash-performance" style={{ fontSize: '1.3rem' }}>{d.performance}</h2>
        <h3 style={{ fontSize: '1.05rem' }}>{d.agencies}</h3>
        {data.agencies.length === 0 ? (
          <p className="muted">{none}</p>
        ) : (
          <table className="table" aria-label={d.agencies}>
            <thead>
              <tr>
                <th scope="col">{d.agency}</th>
                <th scope="col" className="num">{d.inAgency}</th>
                <th scope="col" className="num">{d.deliveredPeriod}</th>
                <th scope="col" className="num">{d.average}</th>
              </tr>
            </thead>
            <tbody>
              {data.agencies.map((a) => (
                <tr key={a.id}>
                  <th scope="row">{a.name} ({a.city})</th>
                  <td className="num">{a.inAgency}</td>
                  <td className="num">{a.deliveredInRange}</td>
                  <td className="num">{hours(a.avgHoursToDeliver)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <h3 style={{ fontSize: '1.05rem', marginTop: 16 }}>{d.drivers}</h3>
        {data.drivers.length === 0 ? (
          <p className="muted">{none}</p>
        ) : (
          <table className="table" aria-label={d.drivers}>
            <thead>
              <tr>
                <th scope="col">{d.driver}</th>
                <th scope="col" className="num">{d.succeeded}</th>
                <th scope="col" className="num">{d.failed}</th>
                <th scope="col" className="num">{d.rate}</th>
              </tr>
            </thead>
            <tbody>
              {data.drivers.map((x) => (
                <tr key={x.id}>
                  <th scope="row">{x.name}</th>
                  <td className="num">{x.succeeded}</td>
                  <td className="num">{x.failed}</td>
                  <td className="num">{x.successRate === null ? d.noMeasure : `${x.successRate} %`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export function StaffDashboardPage() {
  const { m } = useI18n();
  const d = m.delivery.staff.dashboard;
  const canRead = useCan('report:read');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useDashboard(range, canRead);

  function apply() {
    if (from.trim() === '' && to.trim() === '') {
      setError(null);
      setRange(null);
      return;
    }
    const parsed = dashboardQuerySchema.safeParse({ from: from.trim(), to: to.trim() });
    if (!parsed.success || !parsed.data.from || !parsed.data.to) {
      setError(m.common.fixErrors);
      return;
    }
    setError(null);
    setRange({ from: parsed.data.from, to: parsed.data.to });
  }

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{d.title}</h1>
      <p className="lead">{d.lead}</p>
      {!canRead ? <Alert tone="info">{d.forbidden}</Alert> : null}
      {canRead ? (
        <>
          {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
          <div className="form-actions" style={{ alignItems: 'flex-end' }}>
            <TextField name="dashFrom" label={d.from} hint={d.rangeHint} value={from} onChange={setFrom} />
            <TextField name="dashTo" label={d.to} value={to} onChange={setTo} />
            <Button variant="outline" onClick={apply}>
              {d.apply}
            </Button>
          </div>
          {query.isPending ? <p role="status">{m.common.loading}</p> : null}
          {query.isError ? <Alert tone="danger">{m.common.errorLoad}</Alert> : null}
          {query.data ? <Report data={query.data} /> : null}
        </>
      ) : null}
    </>
  );
}
