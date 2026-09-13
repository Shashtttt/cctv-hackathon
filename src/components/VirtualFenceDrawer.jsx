import React from 'react';
import { VirtualFenceConfigModal } from './VirtualFenceConfigModal';

export default function VirtualFenceDrawer({ camera, onClose, onSaveFence }) {
  return (
    <VirtualFenceConfigModal
      camera={camera}
      onClose={onClose}
      onSaveSuccess={(updatedCam) => {
        if (onSaveFence) {
          onSaveFence(updatedCam.id, updatedCam.fence_points);
        }
      }}
    />
  );
}

export { VirtualFenceConfigModal };
