/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Vector2 {
  x: number;
  y: number;
}

export type ObjectType = 'rect' | 'circle' | 'image' | 'group';

export interface AnimObject {
  id: string;
  name: string;
  type: ObjectType;
  parentId: string | null;
  
  // Transformation
  position: Vector2;
  rotation: number; // in degrees
  scale: Vector2;
  pivot: Vector2; // relative to object bounds (0-1 or pixel)
  
  // Styling
  fill: string;
  opacity: number;
  
  // Z-index
  order: number;
  
  // Visibility
  visible: boolean;
  src?: string;
}

export interface ProjectState {
  name: string;
  width: number;
  height: number;
  objects: AnimObject[];
  selectedId: string | null;
  selectedIds: string[];
  currentTime: number; // in milliseconds
  duration: number; // in milliseconds
}

export interface AnimationPreset {
  id: string;
  name: string;
  keyframes: Record<string, any>; // Keyed by property
}
