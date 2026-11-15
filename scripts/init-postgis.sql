-- Initialize PostGIS and register Mars 2000 planetary SRIDs (IAU_2015 sphere R = 3,396,190 m)
CREATE EXTENSION IF NOT EXISTS postgis;

-- SRID 949900: Mars 2000 Planetocentric Geographic (degrees)
INSERT INTO spatial_ref_sys (srid, auth_name, auth_srid, proj4text, srtext)
VALUES (
  949900,
  'IAU_2015',
  49900,
  '+proj=longlat +R=3396190 +no_defs',
  'GEOGCS["Mars 2000",DATUM["D_Mars_2000",SPHEROID["Mars_2000_IAU_IAG",3396190.0,0.0]],PRIMEM["Reference_Meridian",0.0],UNIT["Degree",0.0174532925199433]]'
)
ON CONFLICT (srid) DO NOTHING;

-- SRID 949918: Jezero Crater Local Mars Equidistant Cylindrical (meters, lat_ts = 18.38N)
INSERT INTO spatial_ref_sys (srid, auth_name, auth_srid, proj4text, srtext)
VALUES (
  949918,
  'MARSWALK',
  949918,
  '+proj=eqc +lat_ts=18.38 +lat_0=0 +lon_0=77.58 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs',
  'PROJCS["Mars_2000_Jezero_Equidistant_Cylindrical",GEOGCS["Mars 2000",DATUM["D_Mars_2000",SPHEROID["Mars_2000_IAU_IAG",3396190.0,0.0]],PRIMEM["Reference_Meridian",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Equidistant_Cylindrical"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",77.58],PARAMETER["Standard_Parallel_1",18.38],UNIT["Meter",1.0]]'
)
ON CONFLICT (srid) DO NOTHING;
