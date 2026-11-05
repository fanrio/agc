# Anwenderdokumentation: fanrio-auth (SAP BDC Authorization Wizard)

---

## 1. Start-Möglichkeiten der Anwendung

Die Anwendung (`fanrio-auth`) basiert auf einem **SAP CAP (Node.js)** Backend und einem **React (Vite + Material UI)** Frontend. Sie unterstützt drei Hauptbetriebsmodi: **Test**, **Mock / Dev** und **Production**.

---

### Modus 1: Test (`test`)

Der Test-Modus dient der vollautomatischen Verifikation von Datenmodell, Autorisierungslogik, Berechnungs-Engines und Frontend-Komponenten.

* **Eigenschaften:**
  * Backend verwendet eine temporäre SQLite In-Memory-Datenbank (`:memory:`).
  * Es wird keine persistente Datenbank und keine externe Netzwerkverbindung benötigt.
  * Authentifizierung ist standardmäßig auf `admin` / Synthetic Super-Admin gemockt.

* **Befehle zur Ausführung:**
  ```powershell
  # 1. Backend-Tests ausführen (18 Test-Suiten, 435+ Tests via @sap/cds test)
  npm test

  # 2. Frontend-Komponenten- & Dialog-Tests ausführen (Vitest)
  npm test --prefix app/catalog
  ```

---

### Modus 2: Mock / Lokale Entwicklung (`development` / `mock`)

Dieser Modus ist für die tägliche lokale Entwicklung und UI-Erweiterung gedacht. Es wird keine echte SAP HANA Cloud benötigt.

* **Eigenschaften:**
  * **Datenbank:** Lokale SQLite-Datei (`sqlite.db`), automatisch initialisiert durch CSV-Seed-Dateien in `db/data/`.
  * **Authentifizierung:** `mocked`. Der angemeldete Benutzer kann über den Header `x-simulated-user` bzw. das Benutzer-Dropdown in der Benutzeroberfläche umgeschaltet werden (z. B. `tim.waecken@cimt-ag.de` oder `admin`).
  * **BDC/Datasphere-Anbindung:** Bei Verwendung von Mock-URLs greift das Backend auf integrierte Mock-Ressourcen zurück.

* **Befehle zum Starten:**
  ```powershell
  # Einmalig bzw. nach Änderungen an db/schema.cds: SQLite-Schema aktualisieren
  npx cds deploy

  # Terminal 1: CAP Backend starten (Port 4004)
  npx cds watch

  # Terminal 2: Frontend Dev Server mit Hot-Module-Replacement starten (Port 5173)
  npm run dev --prefix app/catalog
  ```

* **Aufruf im Browser:**
  * Frontend: [http://localhost:5173](http://localhost:5173) (Vite leitet OData-Calls via Proxy an Port 4004 weiter).
  * Backend OData Explorer: [http://localhost:4004](http://localhost:4004).

---

### Modus 3: Produktionsmodus (`production`)

Im Produktionsmodus verbindet sich das CAP-Backend mit der realen **SAP HANA Cloud** und nutzt produktive relationale Tabellen sowie Views (`FANRIO_AUTH_*`).

* **Eigenschaften:**
  * **Datenbank:** SAP HANA Cloud (z. B. `*.hanacloud.ondemand.com:443`).
  * **Autorisierungssynchronisation:** Schreibt direkt in die HANA-Flachtabellen `AUTHORIZATION_FLAT` und die domainspezifischen Tabellen (z. B. `otc_flat_authorizations`).
  * **Authentifizierung:** Im Produktivbetrieb auf der SAP BTP via **XSUAA** (OAuth2/JWT). Für lokale Hybrid-Tests gegen HANA kann die Authentifizierung auf `mocked` gesetzt werden.

* **Befehle für lokalen Hybrid-Betrieb (gegen SAP HANA Cloud):**
  ```powershell
  # 1. Frontend-Produktions-Bundle bauen
  npm run build --prefix app/catalog

  # 2. CAP Backend im Produktionsprofil starten (Terminal 1):
  $env:CDS_REQUIRES_AUTH_KIND="mocked"
  npx cds run --profile production

  # 3. Frontend Preview-Server starten (Terminal 2):
  npm run preview --prefix app/catalog
  ```

* **Aufruf im Browser:**
  * Frontend: [http://localhost:5173](http://localhost:5173)
  * OData v4 Endpunkt: [http://localhost:4004/odata/v4/auth/](http://localhost:4004/odata/v4/auth/)

---

## 2. Deployment auf die SAP Business Technology Platform (SAP BTP)

Das Deployment erfolgt standardkonform als **Multi-Target Application (MTA)** auf die **SAP BTP Cloud Foundry Runtime**.

### Architektur des Deployments (`mta.yaml`)

```
┌────────────────────────────────────────────────────────┐
│                   SAP BTP Subaccount                   │
│                                                        │
│   ┌─────────────────────┐    ┌─────────────────────┐   │
│   │  HTML5 App Repo     │    │  fanrio-cortex-srv  │   │
│   │  (React Frontend)   │    │  (CAP Node.js)      │   │
│   └──────────┬──────────┘    └──────────┬──────────┘   │
│              │                          │              │
│              ▼                          ▼              │
│   ┌─────────────────────┐    ┌─────────────────────┐   │
│   │  XSUAA Service      │    │  SAP HANA Cloud     │   │
│   │  (xs-security.json) │    │  (HDI-Container)    │   │
│   └─────────────────────┘    └─────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

* **Backend-Modul (`fanrio-cortex-srv`):**
  * Typ: Node.js Cloud Foundry Application
  * Buildpack: `nodejs_buildpack`
  * Bindings: `fanrio-cortex-db` (HANA Cloud) und `fanrio-cortex-auth` (XSUAA)
* **Frontend-Modul (`fanriocortexcatalog`):**
  * Typ: HTML5 Application
  * Build: `npm run build` in `app/catalog`
* **Deployer-Modul (`fanrio-cortex-app-deployer`):**
  * Typ: `com.sap.application.content`
  * Lädt das komprimierte React-Bundle (`catalog.zip`) in das HTML5 Application Repository hoch.
* **Verwaltete BTP-Services:**
  * `fanrio-cortex-html5-repo-host`: HTML5 Application Repository (`app-host`).
  * `fanrio-cortex-auth`: SAP Authorization and Trust Management (`xsuaa`) konfiguriert über `xs-security.json`.
  * `fanrio-cortex-db`: SAP HANA Cloud Instanz (`hana-cloud` / Service-Plan `hana-free` oder `tools-hana`).

---

### Schritt-für-Schritt-Anleitung für das BTP Deployment

#### Schritt 1: Voraussetzungen prüfen
Folgende CLI-Werkzeuge müssen auf dem Entwicklungs- bzw. CI/CD-System vorhanden sein:
* **Cloud Foundry CLI:**
  ```bash
  cf -v
  ```
* **Cloud MTA Build Tool (mbt):**
  ```bash
  mbt -v
  ```
* **CF MultiApps Plugin:**
  ```bash
  cf plugins
  # Falls 'multiapps' fehlt:
  cf install-plugin multiapps
  ```

#### Schritt 2: An der BTP Cloud Foundry anmelden
```bash
cf login -a https://api.cf.<region>.hana.ondemand.com -o <Ihre-Org> -s <Ihr-Space>
```
*Beispiel für Region Frankfurt (eu10):*
```bash
cf login -a https://api.cf.eu10.hana.ondemand.com -o mein-unternehmen -s dev
```

#### Schritt 3: MTA-Archiv (`.mtar`) erstellen
Der Build-Befehl transpiliert das React-Frontend, baut das CAP-Backend für die Produktion vor und packt alles in ein deploymentfähiges Archiv:
```powershell
mbt build
```
Nach Abschluss befindet sich das fertige Archiv unter:
`mta_archives/fanrio-cortex_1.0.0.mtar`

#### Schritt 4: Deployment auf SAP BTP durchführen
```powershell
cf deploy mta_archives/fanrio-cortex_1.0.0.mtar
```

**Was das Deployment automatisch ausführt:**
1. Erstellt bzw. aktualisiert die Service-Instanzen (`xsuaa`, `html5-apps-repo`, `hana-cloud`).
2. Führt Datenbankmigrationen auf dem HANA HDI-Container durch.
3. Startet die CAP Node.js Backend-Instanz (`fanrio-cortex-srv`).
4. Überträgt das React Frontend in das HTML5 Application Repository.

#### Schritt 5: Aufruf & Integration
* **SAP Build Work Zone / SAP Fiori Launchpad:** Die Anwendung steht über das HTML5 Application Repository zur Verfügung und kann direkt als Kachel in das zentrale Unternehmensportal eingebunden werden.
* **Direkter Approuter-Zugriff:** Kann über einen Managed Approuter oder Standalone Approuter mit Absicherung über das XSUAA-Login aufgerufen werden.
