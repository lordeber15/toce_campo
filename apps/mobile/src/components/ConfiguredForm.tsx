import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { formAllowsRecords, formContexts, isFormFieldVisible, list20Position, renumberList20, validateFormValues, visibleFormValues, type ExecutionFormData, type FieldRecord, type FormField, type FormSchema, type WpSpecies } from '@toce/shared';
import { useField, type LocalExecution } from '../lib/field';
import { usePackageIndex } from '../lib/workPackage';
import { colors } from '../theme';

type Values = Record<string, unknown>;
const fieldTimeFields:FormField[]=[
  {key:'field_date',label:'Fecha de evaluación',type:'date'},
  {key:'field_start',label:'Hora de inicio',type:'time'},
  {key:'field_end',label:'Hora de término',type:'time'},
];
/** One form per execution; context fields are not repeated for each species. */
export function ConfiguredForm({ execution, schema, onBack }: { execution: LocalExecution; schema: FormSchema; onBack: () => void }) {
  const field = useField(), index = usePackageIndex();
  const [data, setData] = useState<ExecutionFormData>(() => ({...execution.formData,schemaSnapshot:schema}));
  const contexts = formContexts(schema);
  const [contextId, setContextId] = useState(contexts[0]!.id);
  const groups = [...new Set(schema.fields.filter((f) => f.level === 'registro').map((f) => f.group ?? 'registros'))];
  const [group, setGroup] = useState(groups[0] ?? 'registros');
  const [draft, setDraft] = useState<Values>({}), [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState(false), [busy, setBusy] = useState(false), [expanded, setExpanded] = useState(false);
  const [errors, setErrors] = useState<Record<string,string>>({});
  const closed = ['completada','no_realizada'].includes(execution.status);
  const method = index?.methods.get(execution.methodId), station = index?.stations.get(execution.stationId);
  const species = index?.pkg.species.filter((s) => s.specialtyCode === method?.specialtyCode) ?? [];
  const hostOptions = [
    ...(index?.pkg.formHosts??[]).filter((h)=>h.stationId===execution.stationId),
    ...field.executions.filter((e)=>e.stationId===execution.stationId&&index?.methods.get(e.methodId)?.code==='EPV'&&e.formData.header).map((e)=>({id:e.unitId??e.newUnitClientId??e.clientId,executionId:e.clientId,stationId:e.stationId,code:e.unitCode,header:e.formData.header!,lat:e.startLat,lng:e.startLng})),
  ];
  const uniqueHosts=[...new Map(hostOptions.map((h)=>[h.id,h])).values()];
  const header:Values = schema.methodCode==='EPV' ? {...data.header,hospedero_id:execution.unitId??execution.newUnitClientId??execution.clientId} : data.header??{};
  const contextPreset = contexts.find((c) => c.id === contextId)?.values ?? {};
  const context = { ...data.contexts?.[contextId], ...contextPreset };
  const headerFields = schema.fields.filter((f) => f.level === 'unidad');
  const contextFields = schema.fields.filter((f) => f.level === 'subunidad');
  const recordFields = schema.fields.filter((f) => f.level === 'registro' && (f.group ?? 'registros') === group);
  // Forest individuals also belong to subdivisions/categories. Only the TAP
  // indicator-height series is recorded at transect level, outside its readings.
  const isContextGroup = group !== 'alturas_indicadora';
  const contextKey = isContextGroup ? contextId : 'unidad';
  const canAdd = formAllowsRecords({...header,...(isContextGroup ? context : {})});
  const records = data.records.filter((r) => (r.contextId ?? 'unidad') === contextKey && (r.group ?? 'registros') === group);
  const hasDraft = Object.values(draft).some((v)=>v != null && v !== '' && (!Array.isArray(v) || v.length));
  const switchDraft = (action:()=>void) => {
    if(hasDraft && !closed) Alert.alert('Registro sin guardar','Guarda este registro antes de cambiar, o descártalo.',[{text:'Seguir editando'},{text:'Descartar registro',style:'destructive',onPress:action}]);
    else action();
  };
  const mark = (next: ExecutionFormData) => { setData(next); setSaved(false); setErrors({}); };
  const changeHeader = (key: string, value: unknown) => {
    const next = {...header,[key]:value};
    if (!formAllowsRecords(next) && data.records.length) return Alert.alert('Hay registros guardados','Revisa los registros antes de marcar ausencia o falta de evaluación.');
    mark({...data,header:next});
  };
  const changeContext = (key: string, value: unknown) => {
    const next = {...context,[key]:value};
    if (!formAllowsRecords(next) && data.records.some((r) => r.contextId === contextId)) return Alert.alert('Hay registros guardados','Revisa los registros de esta lectura o sección antes de cambiar su resultado.');
    mark({...data,contexts:{...data.contexts,[contextId]:next}});
  };
  async function persist(next = data) {
    setBusy(true);
    try { await field.update(execution.clientId,{formData:next}); setSaved(true); return true; }
    catch (e) { Alert.alert('No se pudo guardar',String(e)); return false; }
    finally { setBusy(false); }
  }
  async function saveHeader() {
    if(hasDraft) return Alert.alert('Registro sin guardar','Pulsa Guardar registro antes de guardar la ficha.');
    const values=visibleFormValues(schema.fields,{...header,...context});
    const errs=validateFormValues([...fieldTimeFields,...headerFields,...contextFields].map((f)=>({...f,required:false})),values);
    if(Object.keys(errs).length){setErrors(errs);return Alert.alert('Revisa los datos','Corrige los campos señalados.');}
    const next={...data,header,contexts:{...data.contexts,[contextId]:context}};
    mark(next);await persist(next);
  }
  async function removeRecord(id:string){
    const remaining=data.records.filter((r)=>r.id!==id);
    const next={...data,records:schema.methodCode==='L20'?renumberList20(remaining):remaining};
    if(await persist(next)){setData(next);setDraft({});setEditing(null);}
  }
  async function saveRecord() {
    let values = {...draft};
    if (schema.methodCode === 'L20') values.posicion_lista = list20Position(values.especie,data.records);
    const all = visibleFormValues(schema.fields,{...header,...(isContextGroup ? context : {}),...values});
    const errs = validateFormValues([...fieldTimeFields,...headerFields,...(isContextGroup ? contextFields : []),...recordFields],all);
    if (!canAdd || Object.keys(errs).length) { setErrors(errs); return Alert.alert('Revisa los datos','Completa los campos señalados antes de guardar el registro.'); }
    const clean = Object.fromEntries(recordFields.filter((f)=>isFormFieldVisible(f,all)).map((f)=>[f.key,all[f.key]]).filter(([,v])=>v != null && v !== ''));
    const old = data.records.find((r)=>r.id===editing), now = new Date().toISOString();
    const record: FieldRecord = { id: old?.id ?? Crypto.randomUUID(), createdAt:old?.createdAt ?? now, updatedAt:now, values:clean,contextId:contextKey,group };
    let updatedRecords=old ? data.records.map((r)=>r.id===old.id ? record : r) : [...data.records,record];
    if(schema.methodCode==='L20'){
      updatedRecords=renumberList20(updatedRecords);
      if(updatedRecords.some((r)=>Number(r.values.posicion_lista)>20))return Alert.alert('Lista de veinte especies','Esta lista ya incluye veinte especies distintas.');
    }
    const next = {...data,header,contexts:{...data.contexts,[contextId]:context},records:updatedRecords};
    mark(next); if(await persist(next)){setDraft({}); setEditing(null);}
  }
  function input(f: FormField, values: Values, change: (key:string,v:unknown)=>void) {
    const visible = visibleFormValues(schema.fields,{...header,...(isContextGroup ? context : {}),...values});
    if (!isFormFieldVisible(f,visible)) return null;
    if(f.type==='relation'&&f.key==='hospedero_id') {
      if(schema.methodCode==='EPV')return <Text key={f.key}>Árbol hospedero: {execution.unitCode}</Text>;
      return <View key={f.key} style={{gap:8}}><Text style={s.label}>Árbol hospedero evaluado en epífitas vasculares *</Text>{uniqueHosts.map((host)=><Pressable key={host.id} disabled={closed||busy} style={[s.button,header.hospedero_id===host.id&&s.selected]} onPress={()=>mark({...data,header:{...header,hospedero_id:host.id,hostExecutionId:host.executionId,especie_hospedero:host.header.especie_hospedero,dap_hospedero:host.header.dap_hospedero,hostCoordinates:{lat:host.lat,lng:host.lng}}})}><Text>{host.code} · {String(host.header.especie_hospedero??'Sin identificación')}</Text></Pressable>)}{!uniqueHosts.length&&<Text>Completa la ficha del hospedero en epífitas vasculares y sincroniza el paquete si fue registrado en otro dispositivo.</Text>}</View>;
    }
    if(schema.methodCode==='EPN'&&f.origin==='Compartido')return <View key={f.key}><Text style={s.label}>{f.label}</Text><Text>{String(values[f.key]??'Sin dato del hospedero seleccionado')}</Text></View>;
    return <ConfigField key={f.key} field={f} value={values[f.key]} disabled={closed || busy || f.origin === 'Calculado' || (f.level === 'subunidad' && Object.hasOwn(contextPreset,f.key))} error={errors[f.key]} species={species} onChange={(v)=>change(f.key,v)} />;
  }
  return <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
    <Pressable onPress={()=>setExpanded(!expanded)} style={s.box}><Text style={s.title}>Datos ya ingresados {expanded ? '−' : '+'}</Text>{expanded && <Text>{station?.code} · {station?.vegetationUnit}{'\n'}{method?.name} · {execution.unitCode}</Text>}</Pressable>
    <View style={s.box}><Text style={s.title}>Fecha y horario de campo</Text>{fieldTimeFields.map((f)=><ConfigField key={f.key} field={f} value={header[f.key]} error={errors[f.key]} disabled={closed||busy} species={[]} onChange={(v)=>changeHeader(f.key,v)}/>)}<Text>Completar con la evaluación real, no con la hora de transcripción.</Text></View>
    {headerFields.length > 0 && <View style={s.box}><Text style={s.title}>Datos de esta evaluación</Text>{headerFields.map((f)=>input(f,header,changeHeader))}</View>}
    {groups.length > 1 && <View style={s.row}>{groups.map((g)=><Pressable key={g} disabled={busy} style={[s.button,g===group&&s.selected]} onPress={()=>switchDraft(()=>{setGroup(g);setDraft({});setEditing(null);})}><Text>{g==='registros'?'Lecturas y especies':g.replaceAll('_',' ')}</Text></Pressable>)}</View>}
    {contexts.length > 1 && isContextGroup && <View style={s.box}><Text style={s.title}>Lectura, sección o subdivisión</Text><ScrollView horizontal><View style={s.row}>{contexts.map((c)=><Pressable key={c.id} disabled={busy} style={[s.button,c.id===contextId&&s.selected]} onPress={()=>switchDraft(()=>{setContextId(c.id);setDraft({});setEditing(null);setErrors({});})}><Text>{c.label}</Text></Pressable>)}</View></ScrollView>{contextFields.map((f)=>input(f,context,changeContext))}</View>}
    {records.length > 0 && <View style={s.box}><Text style={s.title}>Registros guardados: {records.length}</Text>{records.map((r,i)=><View key={r.id} style={s.row}><Pressable disabled={busy} style={s.button} onPress={()=>switchDraft(()=>{setDraft(r.values);setEditing(r.id);})}><Text>{i+1}. {String(r.values.especie ?? Object.values(r.values)[0] ?? 'Registro')}</Text></Pressable>{!closed && <Pressable disabled={busy} accessibilityLabel="Eliminar registro" onPress={()=>switchDraft(()=>Alert.alert('Eliminar registro','¿Eliminar este registro?',[{text:'Cancelar'},{text:'Eliminar',style:'destructive',onPress:()=>void removeRecord(r.id)}]))}><Text>Eliminar</Text></Pressable>}</View>)}</View>}
    {canAdd && <View style={s.box}><Text style={s.title}>{editing?'Editar registro':'Nuevo registro'}</Text>{recordFields.map((f)=>input(f,f.key==='posicion_lista'?{...draft,posicion_lista:list20Position(draft.especie,data.records)}:draft,(k,v)=>{setDraft({...draft,[k]:v});setErrors({});setSaved(false);}))}{!closed&&<Pressable disabled={busy} style={s.action} onPress={()=>void saveRecord()}><Text style={s.white}>Guardar registro</Text></Pressable>}</View>}
    {!closed&&<Pressable disabled={busy} style={s.action} onPress={()=>void saveHeader()}><Text style={s.white}>{busy?'Guardando…':'Guardar ficha'}</Text></Pressable>}
    {saved&&<Text accessibilityRole="alert">Guardado en el dispositivo.</Text>}
    <Pressable disabled={busy} style={s.button} onPress={()=>{ if (closed||(saved&&!hasDraft)) onBack();else Alert.alert('Salir de la ficha','Guarda los cambios antes de salir.',[{text:'Seguir editando'},{text:'Salir sin guardar',onPress:onBack}]); }}><Text>Volver a la unidad</Text></Pressable>
  </ScrollView>;
}

export function ConfigField({field:f,value,disabled,error,species,onChange}:{field:FormField;value:unknown;disabled:boolean;error?:string;species:WpSpecies[];onChange:(v:unknown)=>void}) {
  const [search,setSearch] = useState('');
  const selected = Array.isArray(value) ? value as string[] : [];
  const text = value == null ? '' : String(value);
  const optionLabel = (o:string)=>f.optionLabels?.[o]??o;
  const numeric = (t:string) => { const n=t.trim().replace(',','.'); return n===''?null:Number.isNaN(Number(n))?t:Number(n); };
  let control;
  if (f.type==='select'||f.type==='multiselect') control=<View style={s.row}>{f.options?.map((o)=>{const on=f.type==='multiselect'?selected.includes(o):value===o;return <Pressable key={o} disabled={disabled} style={[s.button,on&&s.selected]} accessibilityRole="checkbox" accessibilityState={{checked:on,disabled}} onPress={()=>onChange(f.type==='multiselect'?(on?selected.filter((x)=>x!==o):[...selected,o]):on?null:o)}><Text>{optionLabel(o)}</Text></Pressable>;})}</View>;
  else if (f.type==='coords') {
    const coords=(value??{}) as Values;
    control=<View style={s.row}>{['lat','lng'].map((key)=><TextInput key={key} style={s.input} editable={!disabled} placeholder={key==='lat'?'Latitud de campo':'Longitud de campo'} value={coords[key]==null?'':String(coords[key])} keyboardType="numbers-and-punctuation" onChangeText={(t)=>onChange({...coords,[key]:numeric(t)})} />)}</View>;
  } else if (f.type==='species_list') control=<View><View style={s.row}>{selected.map((x)=><Pressable disabled={disabled} key={x} onPress={()=>onChange(selected.filter((v)=>v!==x))} style={s.button}><Text>{x} ×</Text></Pressable>)}</View><TextInput style={s.input} editable={!disabled} placeholder="Especie o nombre provisional" value={search} onChangeText={setSearch}/><Pressable disabled={disabled||!search.trim()} style={s.button} onPress={()=>{onChange([...new Set([...selected,search.trim()])]);setSearch('');}}><Text>Agregar especie</Text></Pressable></View>;
  else control=<><TextInput style={[s.input,f.type==='textarea'&&{minHeight:80}]} editable={!disabled} multiline={f.type==='textarea'} placeholder={f.type==='time'?'HH:MM':f.type==='date'?'AAAA-MM-DD':undefined} value={text} keyboardType={f.type==='number'?'decimal-pad':'default'} autoCorrect={f.type!=='species'} onChangeText={(t)=>{onChange(f.type==='number'?numeric(t):t);if(f.type==='species')setSearch(t);}} />{f.type==='species'&&search.length>=2&&!disabled&&species.filter((sp)=>sp.scientificName.toLowerCase().includes(search.toLowerCase())).slice(0,5).map((sp)=><Pressable key={sp.id} style={s.button} onPress={()=>{onChange(sp.scientificName);setSearch('');}}><Text>{sp.scientificName}</Text></Pressable>)}</>;
  return <View style={{gap:6}}><Text style={s.label}>{f.label}{f.unit?` (${f.unit})`:''}{f.required?' *':''}</Text>{control}{!!error&&<Text style={{color:colors.danger}}>{error}</Text>}</View>;
}
const s=StyleSheet.create({wrap:{padding:16,gap:14,paddingBottom:40,backgroundColor:colors.bg},box:{padding:16,gap:12,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:12},title:{fontSize:17,fontWeight:'700',color:colors.text},label:{fontSize:15,fontWeight:'600',color:colors.text},row:{flexDirection:'row',flexWrap:'wrap',gap:8,alignItems:'center'},button:{padding:12,borderWidth:1,borderColor:colors.border,borderRadius:8},selected:{backgroundColor:colors.primarySoft,borderColor:colors.primary},input:{minHeight:44,padding:12,borderWidth:1,borderColor:colors.border,borderRadius:8,color:colors.text},action:{padding:15,backgroundColor:colors.primary,borderRadius:10,alignItems:'center'},white:{color:'#fff',fontWeight:'700'}});
