// Экраны инструментов по идентификатору каталога (V2-036–V2-040).
import type { ComponentType } from 'preact';
import type { ToolInfo } from '../catalog';
import { DistanceDelayTool, ReverbTool, RoomGeometryTool, RoomModesTool, SbirTool, WavelengthTool } from './calculators';
import { AbsorberTool, BassTrapTool, DiffuserTool, MaterialsCompareTool, ResonatorTool } from './design';
import { SignalGeneratorTool, TestSignalsTool } from './generators';
import { DecayTool, NoiseMeterTool, RtaTool, SweepTool } from './measure';
import { CrossoverTool, DirectivityTool, EqualizerTool, PhaseDelayTool, SplHeadroomTool, StereoTriangleTool } from './tuning';

export const TOOL_VIEWS: Record<string, ComponentType<{ tool: ToolInfo }>> = {
  'noise-meter': NoiseMeterTool, rta: RtaTool, sweep: SweepTool, decay: DecayTool,
  'signal-generator': SignalGeneratorTool, 'test-signals': TestSignalsTool,
  wavelength: WavelengthTool, 'room-modes': RoomModesTool, sbir: SbirTool, reverb: ReverbTool, 'distance-delay': DistanceDelayTool, 'room-geometry': RoomGeometryTool,
  absorber: AbsorberTool, 'bass-trap': BassTrapTool, diffuser: DiffuserTool, resonator: ResonatorTool, 'materials-compare': MaterialsCompareTool,
  equalizer: EqualizerTool, crossover: CrossoverTool, 'phase-delay': PhaseDelayTool, 'stereo-triangle': StereoTriangleTool, 'spl-headroom': SplHeadroomTool, directivity: DirectivityTool,
};
