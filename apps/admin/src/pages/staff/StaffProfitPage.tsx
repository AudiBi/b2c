import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { format, useI18n } from '../../i18n';
import { formatMoney } from '../../lib/format';
import { Alert } from '../../components/ui/Alert';
import { TextField } from '../../components/ui/Fields';

interface Month {
  month: string;
  revenue: string;
  customsPassThrough: string;
  cost: string;
  margin: string;
  expenses: string;
  commissions: string;
  incidents: string;
  net: string;
  byMode: Record<'AIR' | 'SEA', { revenue: string; cost: string; margin: string }>;
}
interface Profit {
  currency: string;
  month: string;
  current: Month;
  items: Month[];
  notes: { expensesConvertedFromHtg: boolean; excludedExpenseCurrencies: { currency: string; count: number; total: string }[]; method: string };
}

/** Profit mensuel (administration et comptabilité) : chiffre d'affaires, coût d'achat figé, marge, dépenses, net ; frais CONATEL reversés hors marge. */
export function StaffProfitPage() {
  const { m, lang } = useI18n();
  const p = m.staff.profit;
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const report = useQuery({ queryKey: ['profit', month] as const, queryFn: () => api<Profit>(`/v1/admin/reports/profit?month=${month}`) });
  const data = report.data;
  const money = (v: string) => (data ? formatMoney(v, data.currency, lang) : v);

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{p.title}</h1>
      <p className="lead">{p.lead}</p>
      <div className="card form">
        <TextField name="profitMonth" label={p.month} type="month" value={month} onChange={setMonth} />
      </div>
      {report.isPending ? <p role="status">{m.common.loading}</p> : null}
      {report.isError ? <Alert tone="danger">{m.common.errorLoad}</Alert> : null}
      {data ? (
        <>
          <div className="card">
            <h2 style={{ fontSize: '1.1rem' }}>{format(p.current, { month: data.current.month })}</h2>
            <dl className="kv" data-testid="profit-current">
              <dt>{p.revenue}</dt>
              <dd>{money(data.current.revenue)}</dd>
              <dt>{p.cost}</dt>
              <dd>{money(data.current.cost)}</dd>
              <dt>{p.margin}</dt>
              <dd>
                <strong>{money(data.current.margin)}</strong>
              </dd>
              <dt>{p.expenses}</dt>
              <dd>{money(data.current.expenses)}</dd>
              <dt>{p.commissions}</dt>
              <dd>{money(data.current.commissions)}</dd>
              <dt>{p.incidents}</dt>
              <dd>{money(data.current.incidents)}</dd>
              <dt>{p.net}</dt>
              <dd>
                <strong data-testid="profit-net">{money(data.current.net)}</strong>
              </dd>
              <dt>{p.customs}</dt>
              <dd>{money(data.current.customsPassThrough)}</dd>
            </dl>
            <p className="muted">
              {m.staff.common.modes.AIR} : {money(data.current.byMode.AIR.revenue)} − {money(data.current.byMode.AIR.cost)} = {money(data.current.byMode.AIR.margin)} · {m.staff.common.modes.SEA} : {money(data.current.byMode.SEA.revenue)} − {money(data.current.byMode.SEA.cost)} = {money(data.current.byMode.SEA.margin)}
            </p>
          </div>
          <table className="table" aria-label={p.history}>
            <thead>
              <tr>
                <th scope="col">{p.month}</th>
                <th scope="col">{p.revenue}</th>
                <th scope="col">{p.cost}</th>
                <th scope="col">{p.margin}</th>
                <th scope="col">{p.expenses}</th>
                <th scope="col">{p.net}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.month}>
                  <th scope="row">{row.month}</th>
                  <td className="num">{money(row.revenue)}</td>
                  <td className="num">{money(row.cost)}</td>
                  <td className="num">{money(row.margin)}</td>
                  <td className="num">{money(row.expenses)}</td>
                  <td className="num">{money(row.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">{data.notes.method}</p>
          {data.notes.expensesConvertedFromHtg ? <Alert tone="info">{p.converted}</Alert> : null}
          {data.notes.excludedExpenseCurrencies.length > 0 ? (
            <Alert tone="warning">{format(p.excluded, { list: data.notes.excludedExpenseCurrencies.map((x) => `${x.total} ${x.currency}`).join(', ') })}</Alert>
          ) : null}
        </>
      ) : null}
    </>
  );
}
