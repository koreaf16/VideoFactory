ALTER TABLE locations ADD (
  blender_script CLOB
);
COMMENT ON COLUMN locations.blender_script IS 'Blender bpy script for 3D skeleton generation (Phase 1)';
