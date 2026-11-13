-- Avance de ejemplo para ver el tablero de seguimiento con datos. Se deshace con demo-avance-limpiar.sql (scripts/demo-avance.sh --limpiar).
CREATE TABLE IF NOT EXISTS demo21_backup AS SELECT id, status FROM sampling_units;
CREATE TABLE IF NOT EXISTS demo21_sched AS SELECT id, planned_date, original_date FROM schedules;

DO $$
DECLARE
  today date := (now() AT TIME ZONE 'America/Lima')::date;
  b record; st record; i int := 0; j int; d date; frac numeric;
BEGIN
  FOR b IN SELECT * FROM brigades ORDER BY name LOOP
    i := i + 1; j := 0;
    frac := CASE i WHEN 1 THEN 1.0 WHEN 2 THEN 0.6 WHEN 3 THEN 0.45 WHEN 4 THEN 0.9 ELSE 0.75 END;
    -- Programa las estaciones con métodos de su especialidad que aún no tiene.
    FOR st IN
      SELECT DISTINCT s.id FROM stations s JOIN station_methods sm ON sm.station_id = s.id JOIN methods m ON m.id = sm.method_id
      WHERE s.project_id = b.project_id AND m.specialty_id = b.specialty_id
        AND NOT EXISTS (SELECT 1 FROM schedules x WHERE x.brigade_id = b.id AND x.station_id = s.id)
      ORDER BY s.id
    LOOP
      j := j + 1;
      d := today - 6 + ((i + j * 3) % 10);
      INSERT INTO schedules (project_id, brigade_id, station_id, planned_date, original_date, notes)
      VALUES (b.project_id, b.id, st.id, d, CASE WHEN j = 2 THEN d - 2 ELSE d END, 'DEMO21');
    END LOOP;
    -- Las visitas de hoy ya existentes pasan a hace dos días para que haya historia.
    -- Reparte sus visitas en los últimos días (una reprogramada: fecha original dos días antes).
    UPDATE schedules sc SET planned_date = x.d, original_date = CASE WHEN x.n = 2 THEN x.d - 2 ELSE x.d END
    FROM (SELECT id, row_number() OVER (ORDER BY station_id) AS n,
            today - 7 + ((i * 2 + (row_number() OVER (ORDER BY station_id))::int * 3) % 9) AS d
          FROM schedules WHERE brigade_id = b.id AND notes IS DISTINCT FROM 'DEMO21') x
    WHERE sc.id = x.id;

    -- Ejecuta una fracción de las unidades de las visitas ya vencidas (algunas un día tarde).
    INSERT INTO executions (client_id, sampling_unit_id, station_id, method_id, specialist_id, brigade_id, status, started_at, finished_at, client_updated_at, device_id)
    SELECT gen_random_uuid(), su.id, su.station_id, su.method_id, b.leader_id, b.id, 'completada',
      ((sc.planned_date + CASE WHEN su.seq % 5 = 0 THEN 1 ELSE 0 END)::timestamp + time '08:30') AT TIME ZONE 'America/Lima',
      ((sc.planned_date + CASE WHEN su.seq % 5 = 0 THEN 1 ELSE 0 END)::timestamp + time '09:30') AT TIME ZONE 'America/Lima',
      now(), 'demo21'
    FROM schedules sc
    JOIN station_methods sm ON sm.station_id = sc.station_id
    JOIN methods m ON m.id = sm.method_id AND m.specialty_id = b.specialty_id AND NOT m.is_open_ended
    JOIN sampling_units su ON su.station_method_id = sm.id
    WHERE sc.brigade_id = b.id AND sc.planned_date < today AND su.status = 'pendiente'
      AND su.seq <= ceil(sm.units_required * frac)
      AND (sc.planned_date + CASE WHEN su.seq % 5 = 0 THEN 1 ELSE 0 END) < today;
    UPDATE sampling_units su SET status = 'completada' FROM executions e WHERE e.sampling_unit_id = su.id AND e.device_id = 'demo21' AND e.brigade_id = b.id;
  END LOOP;
  -- Algunas no realizadas (lluvia) en la brigada con menos avance.
  UPDATE sampling_units SET status = 'no_realizada' WHERE id IN (
    SELECT su.id FROM sampling_units su JOIN schedules sc ON sc.station_id = su.station_id JOIN brigades br ON br.id = sc.brigade_id
    JOIN methods m ON m.id = su.method_id AND m.specialty_id = br.specialty_id
    WHERE br.name = (SELECT name FROM brigades ORDER BY name LIMIT 1 OFFSET 2) AND su.status = 'pendiente' AND sc.planned_date < today LIMIT 2);
END $$;
SELECT count(*) || ' visitas, ' || (SELECT count(*) FROM executions WHERE device_id = 'demo21') || ' ejecuciones de ejemplo' FROM schedules WHERE notes = 'DEMO21';
