-- Deshace demo-avance.sql: borra ejecuciones y visitas de ejemplo y restaura estados y fechas.
DELETE FROM executions WHERE device_id = 'demo21';
DELETE FROM schedules WHERE notes = 'DEMO21';
UPDATE sampling_units su SET status = b.status FROM demo21_backup b WHERE b.id = su.id AND su.status <> b.status;
UPDATE schedules sc SET planned_date = b.planned_date, original_date = b.original_date FROM demo21_sched b WHERE b.id = sc.id;
DROP TABLE demo21_backup;
DROP TABLE demo21_sched;
SELECT (SELECT count(*) FROM schedules) || ' visitas, ' || (SELECT count(*) FROM executions) || ' ejecuciones';
