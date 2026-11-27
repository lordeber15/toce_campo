import { getDb } from './db';
import { api } from './api';
export type StationFormDraft={clientId:string;stationMethodId:string;fieldDate:string;values:Record<string,unknown>;updatedAt:string};
export async function queueStationForm(userId:string,draft:StationFormDraft){
  const db=await getDb();
  await db.runAsync('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)',`station_form:${userId}:${draft.clientId}`,JSON.stringify(draft));
}
export async function localStationForms(userId:string):Promise<StationFormDraft[]>{
  const db=await getDb();
  const rows=await db.getAllAsync<{value:string}>('SELECT value FROM meta WHERE key LIKE ?',`station_form:${userId}:%`);
  return rows.map((r)=>JSON.parse(r.value) as StationFormDraft);
}
export async function syncStationForms(userId:string){
  const db=await getDb();
  let firstError:unknown;
  for(const draft of await localStationForms(userId)){
    const stamp=`station_form_synced:${userId}:${draft.clientId}`;
    const prior=await db.getFirstAsync<{value:string}>('SELECT value FROM meta WHERE key=?',stamp);
    if(prior?.value===draft.updatedAt)continue;
    try{
      await api('/field/station-forms',{method:'POST',body:JSON.stringify(draft)});
      // Keep the offline value; only mark the exact submitted timestamp synced.
      await db.runAsync('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)',stamp,draft.updatedAt);
    }catch(e){firstError??=e;}
  }
  if(firstError)throw firstError;
}
export async function pendingStationForms(userId:string):Promise<number>{
  const db=await getDb();
  const row=await db.getFirstAsync<{n:number}>(`SELECT count(*) AS n FROM meta f
    LEFT JOIN meta s ON s.key=replace(f.key,'station_form:','station_form_synced:')
    WHERE f.key LIKE ? AND (s.value IS NULL OR s.value<>json_extract(f.value,'$.updatedAt'))`,`station_form:${userId}:%`);
  return row?.n??0;
}
