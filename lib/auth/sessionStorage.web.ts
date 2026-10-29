import AsyncStorage from '@react-native-async-storage/async-storage';

// Web: no secure enclave; the session lives in localStorage like any web app.
export const sessionStorage = AsyncStorage;
