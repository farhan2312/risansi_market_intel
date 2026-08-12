import fs from 'node:fs'; import pg from 'pg';
const env=fs.readFileSync('.env.local','utf8').replace(/^﻿/,'');
const g=k=>(env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.trim();
const p=new pg.Pool({host:g('DB_HOST'),port:+(g('DB_PORT')||5432),database:g('RISANSI_DB_NAME'),user:g('DB_USER'),password:g('DB_PASSWORD'),ssl:{rejectUnauthorized:false}});
const cr=v=>'Rs '+(Number(v)).toFixed(2)+' Cr';
const w=(await p.query(`SELECT
  COUNT(*)::int n,
  COALESCE(SUM(final_value_cr),0) fin,
  COALESCE(SUM(value_cr),0) val,
  COALESCE(SUM(COALESCE(final_value_cr,value_cr)),0) coalesced
  FROM opportunities WHERE stage='Won'`)).rows[0];
console.log('Won rows:',w.n);
console.log('  SUM(final_value_cr)              ',cr(w.fin),'  <- what the KPI cards use');
console.log('  SUM(value_cr)                    ',cr(w.val));
console.log('  SUM(COALESCE(final,value))       ',cr(w.coalesced),'  <- 27.5 on screen?');
const so=(await p.query(`SELECT COALESCE(SUM(so_value_cr),0) v FROM opportunity_sales_orders s
  WHERE EXISTS (SELECT 1 FROM opportunities o WHERE o.id=s.opportunity_id AND o.stage='Won')`)).rows[0];
console.log('\n  SO-covered (WON SO CREATED)      ',cr(so.v));
console.log('  Awaiting SO = final - SO covered ',cr(Number(w.fin)-Number(so.v)));
console.log('  => KPI pair sums to              ',cr(Number(w.fin)));
console.log('\n=== where the gap comes from ===');
const gap=(await p.query(`SELECT
  COUNT(*) FILTER (WHERE final_value_cr IS NULL)::int no_final,
  COALESCE(SUM(value_cr) FILTER (WHERE final_value_cr IS NULL),0) no_final_val,
  COUNT(*) FILTER (WHERE final_value_cr IS NOT NULL AND value_cr<>final_value_cr)::int differ,
  COALESCE(SUM(value_cr-final_value_cr) FILTER (WHERE final_value_cr IS NOT NULL),0) delta
  FROM opportunities WHERE stage='Won'`)).rows[0];
console.log('  Won rows with NO final_value     :',gap.no_final,'holding',cr(gap.no_final_val),'in value_cr only');
console.log('  Won rows where quote <> final    :',gap.differ,'| SUM(value-final) =',cr(gap.delta));
await p.end();
