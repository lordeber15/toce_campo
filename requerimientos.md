# ESPECIFICACIÓN FUNCIONAL Y REQUERIMIENTOS PARA EL DESARROLLO DE LA APLICACIÓN DE TRABAJO DE CAMPO

## 1. Objetivo general

Desarrollar una aplicación móvil y una plataforma web para gestionar, ejecutar, supervisar y monitorear actividades de trabajo de campo relacionadas con evaluaciones y muestreos ambientales.

La aplicación móvil debe permitir que los especialistas registren información durante sus actividades de campo, incluso sin conexión a Internet. La plataforma web debe permitir que los coordinadores y responsables del proyecto supervisen el avance de las brigadas, atiendan incidencias, gestionen reprogramaciones y generen reportes.

El principio fundamental del diseño es la simplicidad operativa: reducir al mínimo las acciones que debe realizar el personal en campo, automatizando la generación de códigos, la captura de información contextual y el almacenamiento de evidencias.

## 2. Arquitectura funcional

El sistema debe dividirse en dos componentes principales:

### 2.1. Aplicación móvil

Orientada al personal que realiza actividades directamente en campo.

Características:
- Funcionamiento sin conexión a Internet (offline-first).
- Descarga previa de paquetes de trabajo.
- Visualización de estaciones, métodos y unidades de muestreo asignadas.
- Captura de fotografías, coordenadas GPS y datos de campo.
- Registro de incidencias y justificaciones.
- Almacenamiento local de toda la información.
- Sincronización posterior cuando exista conexión.

### 2.2. Plataforma web

Orientada a la planificación, supervisión y gestión del proyecto.

Características:
- Administración de especialistas y brigadas.
- Configuración de estaciones, métodos y unidades de muestreo.
- Gestión de cronogramas.
- Seguimiento del avance de las brigadas.
- Gestión de alertas e incidencias.
- Aprobación de reprogramaciones.
- Consulta de evidencias y registros.
- Generación de reportes diarios y exportación a Excel.

---

# 3. Gestión de usuarios y roles

El sistema debe contemplar los siguientes perfiles funcionales:

## 3.1. Especialista de campo

Es el responsable de ejecutar las actividades de muestreo y registrar los resultados.

Funciones:
- Consultar su jornada de trabajo.
- Consultar las estaciones asignadas.
- Visualizar los métodos habilitados según su especialidad.
- Consultar las unidades de muestreo.
- Visualizar el mapa de trabajo.
- Registrar las actividades realizadas.
- Tomar fotografías y capturar coordenadas GPS.
- Registrar datos de campo.
- Grabar notas de voz.
- Registrar incidencias y justificar actividades no ejecutadas.
- Sincronizar la información cuando tenga conexión.

**Restricción funcional:** cada especialista debe visualizar exclusivamente los métodos y actividades correspondientes a su especialidad. No debe mostrar información de otras especialidades.

## 3.2. Supervisor de campo

Es responsable de supervisar las actividades y documentar las incidencias operativas o metodológicas.

Funciones:
- Consultar las actividades de supervisión.
- Registrar incidencias técnicas.
- Describir desviaciones metodológicas.
- Documentar las acciones correctivas realizadas.
- Registrar cómo se resolvió una incidencia.
- Adjuntar evidencias cuando corresponda.
- Sincronizar los registros posteriormente.

**Consideración importante:** el supervisor trabaja bajo las mismas condiciones de conectividad limitada que los especialistas. Por tanto, su función en la aplicación móvil es documentar y dejar trazabilidad de las incidencias y sus soluciones. No debe depender de una comunicación en tiempo real con la plataforma web.

## 3.3. Responsable logístico

Es responsable de registrar y controlar los recursos necesarios para el trabajo de campo.

Funciones:

**Movilidad**
- Registrar el estado de las movilidades.
- Confirmar la llegada de las unidades.
- Registrar materiales faltantes.
- Reportar materiales defectuosos.
- Adjuntar fotografías de evidencias.

**Apoyos locales**
- Registrar nombres y DNI del personal de apoyo.
- Registrar entrega de equipos de protección personal (EPP).
- Registrar documentación entregada.
- Controlar la disponibilidad de apoyos locales por brigada.

**Viáticos y comprobantes**
- Registrar gastos y compras.
- Adjuntar fotografías de comprobantes.
- Registrar las evidencias de los gastos realizados.

**Muestras y equipos**
- Registrar el estado de las muestras.
- Confirmar los envíos.
- Reportar muestras pendientes.
- Registrar incidencias relacionadas con equipos.

**Incidencias logísticas**
- Reportar accidentes de movilidad.
- Reportar desperfectos mecánicos.
- Informar problemas de hospedaje.
- Registrar cualquier inconveniente que afecte la ejecución del trabajo.

Las incidencias logísticas deben generar alertas para el coordinador.

## 3.4. Coordinador de campo

Es el responsable de monitorear el avance general de las brigadas y gestionar las desviaciones operativas.

Funciones:
- Consultar el avance de todas las brigadas.
- Visualizar las estaciones programadas y ejecutadas.
- Consultar el porcentaje de cumplimiento.
- Identificar desviaciones del cronograma.
- Revisar alertas técnicas y logísticas.
- Consultar el detalle de las incidencias.
- Solicitar información adicional o evidencias.
- Comunicarse con especialistas y supervisores.
- Gestionar y aprobar reprogramaciones.
- Actualizar los cronogramas.
- Generar reportes diarios.
- Descargar reportes de avance en Excel.

## 3.5. Jefe de proyecto

Es responsable de realizar el seguimiento global de la operación.

Funciones:
- Consultar el avance consolidado de todas las brigadas.
- Consultar alertas técnicas y logísticas.
- Revisar incidencias y sus soluciones.
- Consultar el historial de comunicaciones.
- Solicitar información adicional a los responsables.
- Consultar desviaciones metodológicas.
- Revisar información técnica y evidencias.

El jefe de proyecto debe tener una visión global de la operación, sin necesidad de ejecutar las actividades operativas del personal de campo.

---

# 4. Funcionalidades de la aplicación móvil

## 4.1. Preparación del trabajo de campo

Antes de salir a campo, el especialista debe poder descargar un paquete de trabajo.

El paquete debe contener:
- Datos de la brigada.
- Especialista y especialidad asignada.
- Estaciones programadas.
- Métodos habilitados.
- Unidades de muestreo.
- Códigos de identificación.
- Cronograma de actividades.
- Horarios y duración mínima.
- Requisitos metodológicos.
- Información cartográfica necesaria.

La descarga debe realizarse antes de iniciar las actividades sin conexión.

## 4.2. Pantalla principal: Mi jornada

La pantalla principal debe ser minimalista y mostrar únicamente la información necesaria para el trabajo diario.

Elementos:
- Fecha de trabajo.
- Especialidad del usuario.
- Brigada asignada.
- Estaciones programadas.
- Estado de avance.
- Métodos habilitados.
- Unidades de muestreo registradas.
- Estado de sincronización.
- Acceso al mapa.

El usuario debe poder ingresar directamente a una estación y comenzar su actividad sin navegar por múltiples pantallas.

## 4.3. Gestión de estaciones y métodos

Cada estación debe mostrar:
- Código de estación.
- Nombre o identificación.
- Ubicación geográfica.
- Área de estudio o zona de influencia.
- Métodos habilitados.
- Unidades de muestreo correspondientes.
- Estado de ejecución.

Los métodos deben mostrarse exclusivamente según la especialidad del usuario.

Al ingresar a un método, se deben presentar:
- Nombre del método.
- Descripción o instrucciones.
- Número de unidades requeridas.
- Horario de ejecución.
- Duración mínima.
- Requisitos obligatorios.
- Unidades vinculadas.

## 4.4. Registro de unidades de muestreo

Cada unidad debe tener un código único generado automáticamente.

La estructura del código debe responder a la siguiente lógica:

`CÓDIGO_ESTACIÓN + CÓDIGO_MÉTODO + IDENTIFICADOR_UNIDAD`

Ejemplo de referencia:

`EM01-PC01`

Donde:
- EM01: estación de muestreo.
- PC01: punto de conteo número 01.

Los códigos definitivos deben obtenerse de las tablas de configuración proporcionadas por el equipo técnico.

El sistema debe generar automáticamente estos códigos y evitar que el especialista tenga que escribirlos manualmente.

## 4.5. Ejecución del trabajo de campo

El flujo de ejecución debe ser sencillo:

1. Ingresar a la estación.
2. Seleccionar el método habilitado.
3. Seleccionar o iniciar la unidad de muestreo.
4. Iniciar la ejecución.
5. Registrar automáticamente la fecha y hora de inicio.
6. Capturar las coordenadas GPS.
7. Tomar las fotografías correspondientes.
8. Registrar los datos de campo necesarios.
9. Guardar la información.
10. Finalizar la unidad y continuar con la siguiente.

El sistema debe conservar el avance de cada unidad para permitir continuar una actividad interrumpida.

## 4.6. Formulario reducido de datos de campo

El formulario debe contener únicamente los datos que realmente utiliza el especialista durante la actividad.

La información que pueda obtenerse de la configuración debe completarse automáticamente.

Datos automáticos:
- Fecha.
- Hora.
- Estación.
- Método.
- Unidad de muestreo.
- Código de registro.
- Coordenadas GPS.
- Identificación del especialista.

Datos que deben registrarse en campo, según corresponda al método:
- Especie.
- Número de individuos.
- Altura de vuelo.
- Dirección.
- Tipo de vuelo.
- Posición en la lista.
- Hábitat.
- Agrupamiento.

El formulario debe adaptarse a cada método y especialidad. No se deben mostrar campos que no correspondan a la actividad ejecutada.

Los campos definitivos y su obligatoriedad deben validarse con las fichas metodológicas.

## 4.7. Fotografías y evidencias

La captura fotográfica debe estar integrada al flujo de registro.

Cada fotografía debe asociarse automáticamente con:
- Estación.
- Método.
- Unidad de muestreo.
- Fecha y hora.
- Usuario responsable.
- Coordenadas GPS, cuando estén disponibles.

Las fotografías deben almacenarse localmente hasta su sincronización.

La aplicación debe permitir tomar fotografías de evidencias sin obligar al usuario a realizar procesos manuales de carga de archivos.

## 4.8. Grabación de notas de voz

Se debe incorporar una opción para grabar audio durante el trabajo de campo.

Características:
- Botón para iniciar y detener la grabación.
- Asociación del audio con la estación y unidad correspondiente.
- Almacenamiento local.
- Posibilidad de registrar varias notas de voz por unidad.
- Sincronización posterior.

El registro mediante audio debe ser una alternativa opcional al formulario, especialmente cuando el especialista no pueda completar todos los campos durante la actividad.

La conversión de audio a texto y su estructuración automática se considera una funcionalidad posterior para el trabajo de gabinete.

## 4.9. Registro de incidencias y actividades no ejecutadas

Cada estación o unidad de muestreo debe permitir registrar una incidencia.

Tipos de incidencias:
- Incidencia metodológica.
- Condiciones climáticas.
- Lluvia intensa.
- Problemas técnicos.
- Imposibilidad de completar la actividad.
- Otras situaciones operativas.

Datos del registro:
- Estación.
- Método.
- Unidad de muestreo.
- Tipo de incidencia.
- Descripción.
- Fecha y hora.
- Acción propuesta.
- Evidencia fotográfica o documental.
- Estado de ejecución.

Ejemplo:

No se completó el punto de conteo 04 debido a lluvia intensa. Se registra la incidencia, se adjunta evidencia y se propone su reprogramación.

La incidencia debe generar una alerta que posteriormente será revisada por el coordinador.

## 4.10. Sincronización

La aplicación debe trabajar bajo un modelo offline-first.

Requisitos:
- Todos los registros deben guardarse localmente.
- La aplicación debe permitir trabajar sin Internet.
- Debe existir una opción para sincronizar.
- Se debe mostrar el estado de los registros pendientes.
- Se debe informar cuántos registros se sincronizaron.
- Debe evitarse la duplicación de registros.
- Debe conservarse la trazabilidad de las operaciones.

La sincronización debe incluir registros, fotografías, audios, evidencias e incidencias.

---

# 5. Funcionalidades de la plataforma web

## 5.1. Dashboard de seguimiento

La plataforma debe presentar un tablero general de seguimiento de las brigadas.

Indicadores principales:
- Número total de brigadas.
- Estaciones programadas.
- Estaciones ejecutadas.
- Unidades de muestreo ejecutadas.
- Porcentaje de avance.
- Porcentaje de desviación del cronograma.
- Alertas activas.
- Reprogramaciones pendientes.

Debe existir una vista individual por brigada.

Ejemplo de indicadores:
- Estaciones programadas: 8.
- Estaciones ejecutadas: 6.
- Avance: 75 %.
- Desviación del cronograma: 10 %.

La desviación debe calcularse considerando las actividades ejecutadas fuera de su fecha programada.

## 5.2. Seguimiento de brigadas

El coordinador debe poder ingresar a cada brigada y consultar:
- Especialistas asignados.
- Estaciones programadas.
- Métodos ejecutados.
- Unidades registradas.
- Avance por estación.
- Actividades pendientes.
- Desviaciones.
- Última sincronización.
- Alertas relacionadas.

El sistema debe facilitar la identificación de brigadas que presentan retrasos o incumplimientos.

## 5.3. Gestión de alertas

Se deben centralizar las alertas generadas por los diferentes perfiles.

Categorías:
- Alertas técnicas.
- Alertas metodológicas.
- Alertas logísticas.
- Alertas climáticas.
- Alertas por incumplimiento del cronograma.

Cada alerta debe permitir:
- Consultar el detalle.
- Identificar al responsable.
- Revisar evidencias.
- Consultar la estación y unidad relacionada.
- Registrar observaciones.
- Solicitar información adicional.
- Registrar acciones correctivas.
- Consultar el estado de atención.
- Consultar el historial de comunicaciones.

Las alertas deben mantener su trazabilidad desde el registro inicial hasta su atención y cierre.

## 5.4. Gestión de consultas

El coordinador y jefe de proyecto deben poder realizar consultas relacionadas con las actividades de campo.

Una consulta debe permitir:
- Seleccionar brigada.
- Identificar al especialista.
- Identificar la estación o método.
- Registrar la consulta.
- Solicitar información adicional.
- Registrar la respuesta.
- Adjuntar evidencias.
- Consultar el historial.

Se debe poder registrar el seguimiento de las comunicaciones realizadas telefónicamente o por otros medios, incluso cuando no exista conectividad en campo.

## 5.5. Gestión de reprogramaciones

El coordinador debe poder registrar y aprobar reprogramaciones.

Flujo:

1. Se identifica una actividad que no pudo ejecutarse.
2. El especialista registra la incidencia y justificación.
3. La información se sincroniza.
4. El coordinador revisa el caso.
5. El coordinador decide la nueva fecha.
6. Registra el sustento de la modificación.
7. Aprueba la reprogramación.
8. El sistema actualiza el cronograma.
9. Los paquetes de trabajo de las brigadas deben reflejar la nueva programación cuando se actualicen o sincronicen.

Se debe conservar:
- Fecha originalmente programada.
- Fecha reprogramada.
- Motivo.
- Evidencia.
- Responsable de la aprobación.
- Fecha de aprobación.
- Historial de modificaciones.

## 5.6. Reportes

El sistema debe permitir generar:

**Reporte diario**
- Avance de brigadas.
- Estaciones programadas y ejecutadas.
- Unidades de muestreo registradas.
- Incidencias.
- Reprogramaciones.
- Actividades pendientes.

**Reporte consolidado**
- Avance general del proyecto.
- Cumplimiento por brigada.
- Cumplimiento por estación.
- Desviaciones del cronograma.
- Alertas.
- Estado de sincronización.

**Exportación**
- Descarga de información en Excel.
- Consulta de registros históricos.
- Descarga de evidencias asociadas.

---

# 6. Gestión de documentos y evidencias

Se debe reducir la carga manual de documentos.

El sistema debe permitir organizar automáticamente los archivos generados durante las actividades.

La estructura de almacenamiento debe considerar:
- Proyecto.
- Brigada.
- Especialista.
- Estación.
- Método.
- Unidad de muestreo.
- Tipo de archivo.

Se debe facilitar la recuperación de fotografías, audios, comprobantes y documentos sin obligar al usuario a realizar múltiples operaciones manuales de selección y carga.

La organización automática de archivos debe priorizarse como parte de la experiencia de usuario.

---

# 7. Inteligencia artificial y automatización

Las funcionalidades de inteligencia artificial no deben ser un requisito indispensable para la operación inicial en campo.

Se consideran funcionalidades de una etapa posterior, principalmente para el trabajo de gabinete.

## 7.1. Procesamiento de notas de voz

- Transcribir automáticamente los audios.
- Asociar la transcripción con la estación y unidad correspondiente.
- Extraer información relevante.
- Proponer valores para los formularios.
- Permitir revisión y validación humana antes de guardar los resultados.

## 7.2. Análisis de conclusiones y recomendaciones

El sistema podría analizar los documentos elaborados por los especialistas, especialmente las secciones de conclusiones y recomendaciones.

Debe identificar observaciones y clasificarlas en:
- Crítico.
- Alto.
- Mediano.
- Bajo.

La clasificación debe servir como mecanismo de priorización y no como decisión definitiva.

El usuario debe poder revisar el documento original, verificar el contenido que originó la clasificación y modificar el nivel asignado.

## 7.3. Automatización de reportes técnicos

A partir de los datos registrados en campo, el sistema debe permitir:

- Realizar cálculos automáticamente.
- Generar tablas estadísticas.
- Crear gráficos.
- Consolidar información por especialidad y estación.
- Generar documentos Word utilizando plantillas predefinidas.
- Organizar los resultados por títulos y secciones.

La automatización debe aprovechar la información estructurada de la base de datos para reducir el trabajo manual de gabinete.

---

# 8. Requisitos no funcionales

## 8.1. Operación sin conexión

La aplicación móvil debe funcionar sin Internet durante toda la jornada de campo.

## 8.2. Rendimiento

- Reducir los tiempos de carga.
- Optimizar la captura y almacenamiento de fotografías.
- Evitar formularios extensos.
- Permitir registrar información con pocas interacciones.
- Optimizar la descarga de paquetes de campo.

## 8.3. Integridad de información

- Cada registro debe contar con identificador único.
- No deben duplicarse registros durante la sincronización.
- Debe conservarse la fecha y hora de las actividades.
- Debe registrarse el usuario responsable.
- Debe mantenerse el historial de cambios.

## 8.4. Seguridad

- Control de acceso por roles.
- Acceso únicamente a las brigadas y actividades asignadas.
- Protección de información almacenada localmente.
- Comunicación segura con el servidor.
- Validación de usuarios y permisos.
- Respaldo de la información sincronizada.

---

# 9. Prioridades de desarrollo

## Fase 1. Operación de campo (prioridad alta)

- Gestión de usuarios y roles.
- Asignación por especialidad.
- Descarga de paquetes de trabajo.
- Gestión de estaciones.
- Gestión de métodos.
- Gestión de unidades de muestreo.
- Generación automática de códigos.
- Captura GPS.
- Fotografías.
- Formularios reducidos.
- Registro de incidencias.
- Funcionamiento offline.
- Sincronización.

## Fase 2. Supervisión y seguimiento web

- Dashboard de avance.
- Seguimiento por brigadas.
- Gestión de alertas.
- Gestión de consultas.
- Registro de acciones correctivas.
- Reprogramaciones.
- Actualización de cronogramas.
- Reportes diarios.
- Exportación a Excel.

## Fase 3. Automatización y trabajo de gabinete

- Grabación y transcripción de audios.
- Extracción automática de información.
- Clasificación de observaciones.
- Validación asistida por inteligencia artificial.
- Cálculos estadísticos.
- Generación automática de gráficos.
- Generación de documentos Word.

---

# 10. Criterios de aceptación del sistema

El desarrollo se considerará funcionalmente satisfactorio cuando se verifique lo siguiente:

1. Un especialista puede descargar sus actividades antes de salir a campo.
2. Puede visualizar únicamente los métodos de su especialidad.
3. Puede ejecutar sus actividades sin conexión a Internet.
4. Los códigos de las unidades se generan automáticamente.
5. Las fotografías quedan asociadas a su estación y unidad.
6. Las coordenadas y fechas se registran automáticamente.
7. Puede registrar los datos de campo mediante formularios reducidos.
8. Puede grabar notas de voz.
9. Puede reportar incidencias y actividades no ejecutadas.
10. El supervisor puede documentar incidencias y sus soluciones.
11. La sincronización no genera duplicidad de información.
12. El coordinador puede visualizar el avance de las brigadas.
13. El coordinador puede revisar y aprobar reprogramaciones.
14. Las alertas conservan su historial y evidencias.
15. El jefe de proyecto puede consultar el avance global.
16. Se pueden generar reportes diarios y exportar información a Excel.

---

# 11. Principios de diseño y desarrollo

El equipo de desarrollo debe considerar los siguientes principios durante la implementación:

- **Simplicidad:** el especialista debe realizar la menor cantidad posible de acciones durante el trabajo de campo.
- **Automatización:** toda información que pueda obtenerse de la configuración debe completarse automáticamente.
- **Especialización:** cada usuario debe visualizar únicamente las funcionalidades correspondientes a su rol y especialidad.
- **Trabajo offline:** la operación de campo no debe depender de una conexión permanente.
- **Trazabilidad:** toda incidencia, modificación, reprogramación y acción correctiva debe conservar su historial.
- **Evidencias:** fotografías, audios y documentos deben quedar vinculados a las actividades correspondientes.
- **Separación de responsabilidades:** la aplicación móvil debe priorizar la captura de información; la plataforma web debe priorizar el monitoreo, control y análisis.
- **Inteligencia artificial progresiva:** las funcionalidades de IA deben incorporarse posteriormente, sin comprometer la operación básica del sistema.

**Resultado esperado:** una solución integrada que permita planificar, ejecutar, supervisar y analizar las actividades de campo, reduciendo el trabajo administrativo de los especialistas y facilitando el seguimiento operativo del proyecto.