import { create } from 'zustand';

/** Cross-filter of the executive sections: picking an application (Section 3) narrows the server table (Section 4). */
export const useExecCross = create<{ software: string | null; set: (s: string | null) => void }>((set) => ({ software: null, set: (software) => set({ software }) }));
