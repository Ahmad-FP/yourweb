import { useSyncExternalStore } from "react";
import { getLatestConfigurationPreview, subscribeToPreviews } from "../composition/operations";
import { appStore } from "../data/store";

export const useAppState = () => useSyncExternalStore(appStore.subscribe, appStore.getSnapshot, appStore.getSnapshot);

export const useLatestPreview = () => useSyncExternalStore(subscribeToPreviews, getLatestConfigurationPreview, getLatestConfigurationPreview);
