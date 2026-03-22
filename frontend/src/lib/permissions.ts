export type PermissionStateLabel = "idle" | "granted" | "denied" | "error";

type PermissionResult = "granted" | "denied";
type MotionPermissionCtor = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<PermissionResult>;
};
type OrientationPermissionCtor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<PermissionResult>;
};

export async function requestMotionPermissions(): Promise<PermissionStateLabel> {
  try {
    const motionCtor = DeviceMotionEvent as MotionPermissionCtor;
    const orientationCtor = DeviceOrientationEvent as OrientationPermissionCtor;

    if (typeof motionCtor.requestPermission === "function") {
      const result = await motionCtor.requestPermission();
      if (result !== "granted") return "denied";
    }

    if (typeof orientationCtor.requestPermission === "function") {
      const result = await orientationCtor.requestPermission();
      if (result !== "granted") return "denied";
    }

    return "granted";
  } catch (error) {
    console.error(error);
    return "error";
  }
}
