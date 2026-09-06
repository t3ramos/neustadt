# Neustadt v3.0.4 · Keep driving through simulation updates

The driving controller no longer exits the selected vehicle when a worker returns an updated snapshot of the same city. Vehicle pose, throttle and steering remain active. This prevents held W from unexpectedly becoming city-camera input after a simulation update. New/imported cities still create a fresh scene; explicit exit remains available.

Der Fahrmodus bleibt bei Aktualisierungen derselben Stadt aktiv. Fahrzeugposition, Gas und Lenkung werden erhalten. Dadurch wird gehaltenes W nach einem Simulationsupdate nicht mehr unerwartet zur Kartensteuerung. Neue oder importierte Städte erstellen weiterhin eine neue Szene; der bewusste Ausstieg bleibt möglich.

The regression failed before the fix and passes afterward. Browser verification used real W input across three actual worker commits: driving remained active and the map camera did not move. Existing saves are compatible.
