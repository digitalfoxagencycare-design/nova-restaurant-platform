// Position helper: Capacitor Geolocation on the phone, the browser API everywhere else.
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

const shape = (p) => ({
  lat: p.coords.latitude,
  lng: p.coords.longitude,
  // browsers report metres per second; the API field is km/h
  speed: typeof p.coords.speed === "number" && p.coords.speed >= 0 ? Math.round(p.coords.speed * 3.6 * 10) / 10 : undefined,
});

export async function currentPosition() {
  if (Capacitor.isNativePlatform()) {
    const perm = await Geolocation.checkPermissions();
    if (perm.location !== "granted") {
      const asked = await Geolocation.requestPermissions();
      if (asked.location !== "granted") throw new Error("Location permission was refused. Allow it in the phone settings to go online.");
    }
    return shape(await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 12000 }));
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This device cannot share its location."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(shape(p)),
      (e) => reject(new Error(e.code === 1 ? "Location permission was refused. Allow it to go online." : "Could not find your location. Try again outside or near a window.")),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 },
    );
  });
}

export async function batteryPercent() {
  try {
    if (navigator.getBattery) return Math.round((await navigator.getBattery()).level * 100);
  } catch { /* not available */ }
  return undefined;
}
