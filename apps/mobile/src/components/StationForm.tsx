import { useEffect,useRef,useState } from 'react';
import { Alert,Pressable,Text,TextInput,View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { validateFormValues,type WpMethod } from '@toce/shared';
import { useAuth } from '../lib/auth';
import { useField } from '../lib/field';
import { useWorkPackage } from '../lib/workPackage';
import { localStationForms,queueStationForm,type StationFormDraft } from '../lib/stationForms';
import { ConfigField } from './ConfiguredForm';
export function StationForm({method,stationMethodId}:{method:WpMethod;stationMethodId:string}){
  const {user}=useAuth(),field=useField(),{pkg}=useWorkPackage();
  const [draft,setDraft]=useState<StationFormDraft>({clientId:Crypto.randomUUID(),stationMethodId,fieldDate:'',values:{},updatedAt:''});
  const [loaded,setLoaded]=useState(false),[message,setMessage]=useState('');
  const loadedKey=useRef('');
  const fields=method.formSchema.fields.filter((f)=>f.level==='estacion_metodo');
  useEffect(()=>{let cancelled=false;if(!user)return;const key=user.id+stationMethodId;if(loadedKey.current===key)return;void localStationForms(user.id).then((local)=>{
    const choices=[...(pkg?.stationForms??[]),...local].filter((x)=>x.stationMethodId===stationMethodId).sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt));
    if(!cancelled){if(choices.length)setDraft(choices[choices.length-1]!);setLoaded(true);loadedKey.current=key;}
  });return()=>{cancelled=true;};},[user,stationMethodId,pkg?.stationForms]);
  if(!fields.length)return null;
  async function save(){
    if(!user)return;
    if(Object.keys(validateFormValues([...fields,{key:'fieldDate',label:'Fecha',type:'date',required:true}],{...draft.values,fieldDate:draft.fieldDate})).length)return Alert.alert('Completa la ficha','Indica una fecha de campo válida y la disponibilidad de hospederos.');
    try{await queueStationForm(user.id,{...draft,updatedAt:new Date().toISOString()});setMessage('Guardado en el dispositivo; se enviará al sincronizar.');void field.syncNow();}catch(e){Alert.alert('No se pudo guardar',String(e));}
  }
  return <View style={{gap:10,padding:12}}><Text>Disponibilidad de hospederos en esta estación</Text><TextInput editable={loaded} accessibilityLabel="Fecha de evaluación" placeholder="Fecha de campo: AAAA-MM-DD" value={draft.fieldDate} onChangeText={(fieldDate)=>setDraft({...draft,fieldDate})}/>{fields.map((f)=><ConfigField key={f.key} field={f} value={draft.values[f.key]} disabled={!loaded} species={[]} onChange={(v)=>setDraft({...draft,values:{...draft.values,[f.key]:v}})}/>)}<Pressable disabled={!loaded} onPress={()=>void save()}><Text>Guardar estado de hospederos</Text></Pressable><Text>{message}</Text></View>;
}
