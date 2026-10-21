"""Build the procedural Tower Bridge spike scene inside Blender.

The timeline is the source of truth for beat timing and camera poses. All
motion is stored as ordinary Blender keyframes so a frame can be rendered
without wall-clock callbacks.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def args_after_separator() -> argparse.Namespace:
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--timeline", required=True)
    parser.add_argument("--width", type=int)
    parser.add_argument("--height", type=int)
    parser.add_argument("--fps", type=int)
    parser.add_argument("--samples", type=int, default=16)
    parser.add_argument("--out", required=True, help="Output scene .blend path")
    parser.add_argument("--format", choices=("png", "ffmpeg"), default="png")
    parser.add_argument("--render-output", required=True, help="Render output path or PNG sequence prefix")
    return parser.parse_args(raw)


def frame_at(seconds: float, fps: int) -> int:
    return max(1, int(round(seconds * fps)) + 1)


def set_if_present(owner, name: str, value) -> None:
    if hasattr(owner, name):
        setattr(owner, name, value)


def set_socket(node, names: tuple[str, ...], value) -> None:
    for name in names:
        socket = node.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return


def make_material(name: str, color: tuple[float, float, float], roughness: float = 0.7):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1.0)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    set_socket(bsdf, ("Base Color",), (*color, 1.0))
    set_socket(bsdf, ("Roughness",), roughness)
    return material, bsdf


def wood_material():
    material, bsdf = make_material("Procedural weathered wood", (0.37, 0.25, 0.15), 0.72)
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    texture = nodes.new("ShaderNodeTexNoise")
    texture.inputs["Scale"].default_value = 5.0
    texture.inputs["Detail"].default_value = 4.0
    texture.inputs["Roughness"].default_value = 0.76
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.2
    ramp.color_ramp.elements[0].color = (0.13, 0.085, 0.052, 1.0)
    ramp.color_ramp.elements[1].position = 0.82
    ramp.color_ramp.elements[1].color = (0.57, 0.42, 0.28, 1.0)
    links.new(texture.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.16
    bump.inputs["Distance"].default_value = 0.07
    links.new(texture.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material


def water_material():
    material, bsdf = make_material("Deep teal river with whitecaps", (0.018, 0.19, 0.23), 0.23)
    set_socket(bsdf, ("Metallic",), 0.08)
    set_socket(bsdf, ("Transmission Weight", "Transmission"), 0.08)

    nodes = material.node_tree.nodes
    links = material.node_tree.links
    foam_attribute = nodes.new("ShaderNodeVertexColor")
    foam_attribute.layer_name = "foam"

    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 3.2
    noise.inputs["Detail"].default_value = 2.0
    threshold = nodes.new("ShaderNodeMath")
    threshold.operation = "GREATER_THAN"
    threshold.inputs[1].default_value = 0.68
    links.new(noise.outputs["Fac"], threshold.inputs[0])

    max_mask = nodes.new("ShaderNodeMath")
    max_mask.operation = "MAXIMUM"
    foam_luma = nodes.new("ShaderNodeRGBToBW")
    links.new(foam_attribute.outputs["Color"], foam_luma.inputs["Color"])
    links.new(foam_luma.outputs["Val"], max_mask.inputs[0])
    links.new(threshold.outputs[0], max_mask.inputs[1])

    mix = nodes.new("ShaderNodeMixRGB")
    mix.blend_type = "MIX"
    mix.inputs[1].default_value = (0.012, 0.12, 0.17, 1.0)
    mix.inputs[2].default_value = (0.78, 0.91, 0.9, 1.0)
    links.new(max_mask.outputs[0], mix.inputs[0])
    links.new(mix.outputs[0], bsdf.inputs["Base Color"])

    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.13
    bump.inputs["Distance"].default_value = 0.09
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material


def add_cube(name: str, location, dimensions, material, bevel: float = 0.0):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material is not None:
        obj.data.materials.append(material)
    if bevel > 0:
        modifier = obj.modifiers.new("Soft manufactured edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        obj.modifiers.new("Weighted corner normals", "WEIGHTED_NORMAL")
    return obj


def add_cylinder(name: str, location, radius: float, depth: float, material, vertices: int = 12):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    if material is not None:
        obj.data.materials.append(material)
    for face in obj.data.polygons:
        face.use_smooth = True
    return obj


def animate_location(obj, start_frame: int, end_frame: int, start, end) -> None:
    obj.location = start
    obj.keyframe_insert(data_path="location", frame=start_frame)
    obj.location = end
    obj.keyframe_insert(data_path="location", frame=end_frame)


def animate_scale(obj, start_frame: int, end_frame: int, start, end) -> None:
    obj.scale = start
    obj.keyframe_insert(data_path="scale", frame=start_frame)
    obj.scale = end
    obj.keyframe_insert(data_path="scale", frame=end_frame)


def add_rope(name: str, points, material, start_frame: int | None = None, end_frame: int | None = None):
    curve = bpy.data.curves.new(name, type="CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 12
    curve.bevel_resolution = 3
    curve.bevel_depth = 0.035
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, coordinates in zip(spline.bezier_points, points):
        point.co = coordinates
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    if material is not None:
        curve.materials.append(material)
    if start_frame is not None and end_frame is not None:
        curve.bevel_depth = 0.0
        curve.keyframe_insert(data_path="bevel_depth", frame=start_frame)
        curve.bevel_depth = 0.035
        curve.keyframe_insert(data_path="bevel_depth", frame=end_frame)
    return obj


def add_box_room(material, length: float, width: float) -> None:
    add_cube("Pale cyan diorama floor", (0, 0, -0.42), (24, 30, 0.5), material)
    add_cube("Left pale box wall", (-7.0, 0, 4.0), (0.22, 30, 9.0), material)
    # Keep the camera-facing side open; the flyby camera sits beyond x=7 and
    # the former right wall completely occluded the bridge from every beat.
    add_cube("Far pale box wall", (0, length * 0.57, 4.0), (14.2, 0.22, 9.0), material)


def add_ocean(length: float, width: float, water_mat):
    bpy.ops.mesh.primitive_plane_add(size=2.0, location=(0, 0, 0.04))
    ocean_obj = bpy.context.object
    ocean_obj.name = "Animated river water"
    ocean = ocean_obj.modifiers.new("Procedural ocean and foam", "OCEAN")
    ocean.geometry_mode = "GENERATE"
    ocean.spatial_size = math.ceil(max(length, width))
    ocean.resolution = 7
    ocean.viewport_resolution = 5
    ocean.wave_scale = 1.1
    ocean.wave_scale_min = 0.35
    ocean.choppiness = 0.7
    ocean.wind_velocity = 8.0
    ocean.use_foam = True
    ocean.foam_layer_name = "foam"
    ocean.foam_coverage = -0.2
    ocean.random_seed = 17
    ocean.use_normals = True
    ocean.time = 0.0
    ocean.keyframe_insert(data_path="time", frame=1)
    ocean.time = 7.0
    ocean.keyframe_insert(data_path="time", frame=631)
    size = float(ocean.spatial_size)
    ocean_obj.scale = (width / size, length / size, 1.0)
    ocean_obj.data.materials.append(water_mat)
    return ocean_obj


def setup_scene(timeline, width: int, height: int, fps: int, samples: int):
    scene = bpy.context.scene
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    engine_ids = {
        item.identifier
        for item in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items
    }
    eevee_id = next(
        (candidate for candidate in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE") if candidate in engine_ids),
        None,
    )
    if eevee_id is None:
        raise RuntimeError(f"This Blender build has no supported Eevee engine; found {sorted(engine_ids)}")
    scene.render.engine = eevee_id
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.fps = fps
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.frame_start = 1
    last_beat = max(beat["start"] + beat["dur"] for beat in timeline["beats"])
    scene.frame_end = max(1, int(round(last_beat * fps)))

    eevee = getattr(scene, "eevee", None)
    if eevee is not None:
        for property_name in ("taa_render_samples", "taa_samples"):
            set_if_present(eevee, property_name, samples)
        set_if_present(eevee, "use_gtao", True)
        set_if_present(eevee, "gtao_distance", 3.0)
        set_if_present(eevee, "gtao_factor", 1.25)
        set_if_present(eevee, "use_soft_shadows", True)

    color_transforms = {item.name for item in scene.view_settings.bl_rna.properties["view_transform"].enum_items}
    if "AgX" in color_transforms:
        scene.view_settings.view_transform = "AgX"
    looks = {
        item.identifier
        for item in scene.view_settings.bl_rna.properties["look"].enum_items
    }
    preferred_look = "AgX - Medium High Contrast"
    if preferred_look in looks:
        scene.view_settings.look = preferred_look
    elif "Medium High Contrast" in looks:
        scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0

    world = bpy.data.worlds.new("Pale cyan studio atmosphere")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.46, 0.76, 0.81, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.7
    scene.world = world

    return scene


def create_camera(scene, timeline, fps: int):
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.name = "Continuous moving camera"
    scene.camera = camera
    camera.data.lens = 53
    for beat in timeline["beats"]:
        frame = frame_at(beat["start"], fps)
        pose = beat["camera"]
        position = Vector(pose["position"])
        target = Vector(pose["target"])
        camera.location = position
        camera.rotation_euler = (target - position).to_track_quat("-Z", "Y").to_euler()
        camera.data.lens = pose.get("lens", camera.data.lens)
        camera.keyframe_insert(data_path="location", frame=frame)
        camera.keyframe_insert(data_path="rotation_euler", frame=frame)
        camera.data.keyframe_insert(data_path="lens", frame=frame)
    return camera


def add_lighting():
    bpy.ops.object.light_add(type="AREA", location=(-5.0, -8.0, 13.0))
    key = bpy.context.object
    key.name = "Large softbox key light"
    key.data.energy = 1800
    key.data.shape = "DISK"
    key.data.size = 9.0
    key.rotation_euler = (math.radians(28), 0, math.radians(-28))

    bpy.ops.object.light_add(type="AREA", location=(6.0, 5.0, 10.0))
    fill = bpy.context.object
    fill.name = "Soft cyan fill light"
    fill.data.energy = 900
    fill.data.shape = "DISK"
    fill.data.size = 7.0
    fill.rotation_euler = (math.radians(18), 0, math.radians(150))


def op_river(op, context):
    length = float(op.get("length", 22))
    width = float(op.get("width", 8.5))
    context["dimensions"] = {"length": length, "width": width}
    room = make_material("Pale cyan-white room", (0.66, 0.87, 0.89), 0.88)[0]
    wood = wood_material()
    rope = make_material("Dark warm suspension rope", (0.12, 0.075, 0.045), 0.9)[0]
    water = water_material()
    context["materials"].update({"room": room, "wood": wood, "rope": rope, "water": water})
    add_box_room(room, length, width)
    add_cube("River channel bed", (0, 0, -0.12), (width, length, 0.3), room)
    add_cube("Left raised river edge", (-width / 2 - 0.15, 0, 0.13), (0.3, length, 0.6), room, 0.08)
    add_cube("Right raised river edge", (width / 2 + 0.15, 0, 0.13), (0.3, length, 0.6), room, 0.08)
    context["ocean"] = add_ocean(length, width, water)

    volume_mat = bpy.data.materials.new("Light room haze")
    volume_mat.use_nodes = True
    volume_nodes = volume_mat.node_tree.nodes
    volume_nodes.clear()
    output = volume_nodes.new("ShaderNodeOutputMaterial")
    volume = volume_nodes.new("ShaderNodeVolumePrincipled")
    volume.inputs["Density"].default_value = 0.004
    volume.inputs["Color"].default_value = (0.72, 0.9, 0.91, 1.0)
    volume_mat.node_tree.links.new(volume.outputs["Volume"], output.inputs["Volume"])
    haze = add_cube("Very light atmospheric haze volume", (0, 0, 3.5), (14, 30, 8), volume_mat)
    haze.display_type = "WIRE"


def op_add_rocks(op, context):
    stone = make_material("Smooth river stones", (0.3, 0.34, 0.32), 0.91)[0]
    count = int(op.get("count", 4))
    placements = [(-3.0, -5.5, 0.06), (2.5, 2.8, 0.08), (-2.7, 7.0, 0.05), (3.1, -8.0, 0.04)]
    for index in range(count):
        location = placements[index % len(placements)]
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1, location=location)
        rock = bpy.context.object
        rock.name = f"Procedural river rock {index + 1}"
        rock.scale = (0.25 + 0.05 * (index % 2), 0.35, 0.18)
        rock.data.materials.append(stone)
        for face in rock.data.polygons:
            face.use_smooth = True


def op_drop_deck(op, context, start_frame, end_frame):
    wood = context["materials"]["wood"]
    count = int(op.get("planks", 24))
    span = float(op.get("span", 8.8))
    deck_width = float(op.get("deck_width", 1.2))
    deck_z = float(op.get("deck_z", 1.55))
    cell = span / count
    deck = []
    for index in range(count):
        x = -span / 2 + (index + 0.5) * cell
        plank = add_cube(
            f"Bridge deck plank {index + 1:02d}",
            (x, 0, deck_z),
            (cell * 0.94, deck_width, 0.15),
            wood,
            0.035,
        )
        delay = int(round((end_frame - start_frame) * index / max(count - 1, 1) * 0.32))
        plank.location.z = 4.6
        plank.rotation_euler[1] = math.radians(7 if index % 2 else -6)
        plank.scale.z = 0.01
        plank.keyframe_insert(data_path="location", frame=1)
        plank.keyframe_insert(data_path="rotation_euler", frame=1)
        plank.keyframe_insert(data_path="scale", frame=1)
        plank.keyframe_insert(data_path="location", frame=max(1, start_frame + delay - 1))
        plank.keyframe_insert(data_path="rotation_euler", frame=max(1, start_frame + delay - 1))
        plank.keyframe_insert(data_path="scale", frame=max(1, start_frame + delay - 1))
        plank.scale.z = 1.0
        plank.keyframe_insert(data_path="location", frame=start_frame + delay)
        plank.keyframe_insert(data_path="rotation_euler", frame=start_frame + delay)
        plank.keyframe_insert(data_path="scale", frame=start_frame + delay)
        plank.location.z = deck_z
        plank.rotation_euler[1] = 0
        plank.keyframe_insert(data_path="location", frame=min(end_frame, start_frame + delay + int(round(0.7 * bpy.context.scene.render.fps))))
        plank.keyframe_insert(data_path="rotation_euler", frame=min(end_frame, start_frame + delay + int(round(0.7 * bpy.context.scene.render.fps))))
        deck.append(plank)
        context["bridge_objects"].append(plank)
    context["deck"] = deck
    context["deck_z"] = deck_z
    context["span"] = span
    context["deck_width"] = deck_width


def op_add_piers(op, context, start_frame, end_frame):
    wood = context["materials"]["wood"]
    count = int(op.get("count", 7))
    height = float(op.get("height", 1.4))
    span = context.get("span", 8.8)
    deck_z = context.get("deck_z", 1.55)
    piers = []
    for index in range(count):
        x = -span * 0.42 + index * span * 0.84 / max(count - 1, 1)
        depth = max(0.2, min(height, deck_z - 0.05))
        pier = add_cylinder(f"Low bridge pier {index + 1}", (x, 0, 0.1 + depth / 2), 0.13, depth, wood)
        pier.scale.z = 0.01
        pier.keyframe_insert(data_path="scale", frame=start_frame)
        pier.scale.z = 1.0
        pier.keyframe_insert(data_path="scale", frame=end_frame)
        piers.append(pier)
        context["bridge_objects"].append(pier)
    context["piers"] = piers


def op_reduce_piers(op, context, start_frame, end_frame):
    piers = context.get("piers", [])
    keep = int(op.get("keep", 3))
    if len(piers) <= keep:
        return
    selected = set(round(i * (len(piers) - 1) / max(keep - 1, 1)) for i in range(keep))
    for index, pier in enumerate(piers):
        if index in selected:
            continue
        pier.scale.z = 1.0
        pier.keyframe_insert(data_path="scale", frame=start_frame)
        pier.scale.z = 0.01
        pier.keyframe_insert(data_path="scale", frame=end_frame)


def op_raise_towers(op, context, start_frame, end_frame):
    if context.get("towers"):
        return
    wood = context["materials"]["wood"]
    span = context.get("span", 8.8)
    deck_width = context.get("deck_width", 1.2)
    deck_z = context.get("deck_z", 1.55)
    tower_height = float(op.get("height", 5.6))
    towers = []
    for x_sign in (-1, 1):
        x = x_sign * (span / 2 - 0.18)
        for y_sign in (-1, 1):
            y = y_sign * deck_width * 0.46
            post = add_cylinder(
                f"Suspension tower post {x_sign:+d} {y_sign:+d}",
                (x, y, deck_z + tower_height / 2),
                0.17,
                tower_height,
                wood,
                vertices=10,
            )
            post.scale.z = 0.01
            post.location.z = deck_z + 0.02
            post.keyframe_insert(data_path="scale", frame=start_frame)
            post.keyframe_insert(data_path="location", frame=start_frame)
            post.scale.z = 1.0
            post.location.z = deck_z + tower_height / 2
            post.keyframe_insert(data_path="scale", frame=end_frame)
            post.keyframe_insert(data_path="location", frame=end_frame)
            towers.append(post)
            context["bridge_objects"].append(post)
    for x_sign in (-1, 1):
        crossbeam = add_cube(
            f"Tower crossbeam {x_sign:+d}",
            (x_sign * (span / 2 - 0.18), 0, deck_z + tower_height - 0.14),
            (0.28, deck_width * 1.4, 0.22),
            wood,
            0.035,
        )
        crossbeam.scale.z = 0.01
        crossbeam.keyframe_insert(data_path="scale", frame=start_frame)
        crossbeam.scale.z = 1.0
        crossbeam.keyframe_insert(data_path="scale", frame=end_frame)
        towers.append(crossbeam)
        context["bridge_objects"].append(crossbeam)
    context["towers"] = towers
    context["tower_height"] = tower_height


def op_hang_ropes(op, context, start_frame, end_frame):
    if context.get("ropes"):
        return
    rope_mat = context["materials"]["rope"]
    span = context.get("span", 8.8)
    deck_width = context.get("deck_width", 1.2)
    deck_z = context.get("deck_z", 1.55)
    tower_height = context.get("tower_height", 5.6)
    sag = float(op.get("sag", 0.9))
    cable_top = deck_z + tower_height - 0.12
    ropes = []
    for y_sign in (-1, 1):
        y = y_sign * deck_width * 0.46
        main = add_rope(
            f"Main catenary cable {y_sign:+d}",
            [
                (-span / 2 + 0.14, y, cable_top),
                (-span * 0.24, y, cable_top - sag * 0.52),
                (0, y, cable_top - sag),
                (span * 0.24, y, cable_top - sag * 0.52),
                (span / 2 - 0.14, y, cable_top),
            ],
            rope_mat,
            start_frame,
            end_frame,
        )
        ropes.append(main)
        hanger_count = int(op.get("hangers", 11))
        for index in range(hanger_count):
            x = -span * 0.37 + index * (span * 0.74 / max(hanger_count - 1, 1))
            fraction = abs(x) / (span / 2)
            top_z = cable_top - sag * (1 - fraction * fraction)
            hanger = add_rope(
                f"Vertical hanger {y_sign:+d} {index + 1:02d}",
                [(x, y, deck_z + 0.2), (x, y, top_z)],
                rope_mat,
                start_frame,
                end_frame,
            )
            ropes.append(hanger)
        context["bridge_objects"].extend(ropes)
    context["ropes"] = ropes


def make_boat_root(name: str, y: float):
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    root.location = (0, y, 0.35)
    return root


def attach_to_root(obj, root):
    obj.parent = root
    obj.matrix_parent_inverse.identity()
    return obj


def make_yacht(context):
    root = make_boat_root("Modern white yacht root", 0)
    white = make_material("Clean white yacht hull", (0.83, 0.86, 0.82), 0.32)[0]
    dark = make_material("Yacht dark hull and glazing", (0.035, 0.095, 0.12), 0.28)[0]
    gold = make_material("Warm yacht trim", (0.65, 0.39, 0.12), 0.5)[0]
    hull = add_cube("Yacht hull", (0, 0, 0.08), (1.15, 2.3, 0.36), dark, 0.22)
    attach_to_root(hull, root)
    deck = add_cube("Yacht white deck", (0, 0, 0.28), (1.03, 2.05, 0.14), white, 0.18)
    attach_to_root(deck, root)
    cabin = add_cube("Yacht cabin", (0, -0.16, 0.52), (0.76, 0.85, 0.42), white, 0.12)
    attach_to_root(cabin, root)
    window = add_cube("Yacht wraparound dark windows", (0, 0.04, 0.56), (0.79, 0.48, 0.25), dark, 0.04)
    attach_to_root(window, root)
    trim = add_cube("Yacht bow trim", (0, 0.92, 0.32), (0.76, 0.08, 0.08), gold, 0.025)
    attach_to_root(trim, root)
    return root


def op_spawn_yacht(op, context, start_frame, end_frame, fps):
    root = context.get("yacht") or make_yacht(context)
    context["yacht"] = root
    delay = int(round(float(op.get("delay_sec", 0.0)) * fps))
    begin = start_frame + delay
    from_y = float(op.get("from_y", -8.0))
    blocked_y = float(op.get("blocked_y", -1.1))
    root.location = (0, from_y, 0.35)
    root.scale = (0.01, 0.01, 0.01)
    root.keyframe_insert(data_path="location", frame=begin)
    root.keyframe_insert(data_path="scale", frame=begin)
    root.scale = (1, 1, 1)
    root.keyframe_insert(data_path="scale", frame=min(begin + 5, end_frame))
    root.location = (0, blocked_y, 0.35)
    root.keyframe_insert(data_path="location", frame=end_frame)
    context["yacht_blocked_y"] = blocked_y


def op_pass_yacht(op, context, start_frame, end_frame):
    root = context.get("yacht")
    if root is None:
        return
    blocked_y = context.get("yacht_blocked_y", root.location.y)
    root.location = (0, blocked_y, 0.35)
    root.keyframe_insert(data_path="location", frame=start_frame)
    root.location = (0, float(op.get("to_y", 7.5)), 0.35)
    root.keyframe_insert(data_path="location", frame=end_frame)


def make_sailing_ship(context):
    root = make_boat_root("Tall wooden sailing ship root", 0)
    hull_mat = make_material("Dark timber sailing hull", (0.2, 0.095, 0.05), 0.67)[0]
    trim = make_material("Ship cream rails", (0.77, 0.69, 0.48), 0.72)[0]
    sail_mat = make_material("Warm linen sails", (0.78, 0.62, 0.34), 0.85)[0]
    accent = make_material("Ship orange pennant", (0.83, 0.2, 0.08), 0.7)[0]

    hull = add_cube("Sailing ship hull", (0, 0, 0.08), (1.05, 2.35, 0.58), hull_mat, 0.18)
    attach_to_root(hull, root)
    gunwale = add_cube("Sailing ship cream gunwale", (0, 0, 0.4), (0.98, 2.18, 0.13), trim, 0.06)
    attach_to_root(gunwale, root)
    mast = add_cylinder("Sailing ship mast", (0, 0.15, 2.05), 0.055, 3.35, hull_mat, vertices=8)
    attach_to_root(mast, root)
    second_mast = add_cylinder("Sailing ship rear mast", (0, -0.55, 1.55), 0.042, 2.45, hull_mat, vertices=8)
    attach_to_root(second_mast, root)

    def triangle(name, vertices, material):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(vertices, [], [(0, 1, 2)])
        mesh.materials.append(material)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        return attach_to_root(obj, root)

    triangle("Large linen sail", [(-0.02, 0.18, 3.6), (-0.02, 0.18, 0.72), (-0.02, 1.08, 0.95)], sail_mat)
    triangle("Rear linen sail", [(0.02, -0.5, 2.75), (0.02, -0.5, 0.92), (0.02, -1.08, 1.05)], sail_mat)
    triangle("Small orange pennant", [(0, 0.15, 3.85), (0, 0.15, 3.42), (0.75, 0.15, 3.57)], accent)
    return root


def op_spawn_ship(op, context, start_frame, end_frame):
    root = context.get("sailing_ship") or make_sailing_ship(context)
    context["sailing_ship"] = root
    from_y = float(op.get("from_y", 9.0))
    approach_y = float(op.get("approach_y", 1.2))
    root.location = (0, from_y, 0.0)
    root.scale = (0.01, 0.01, 0.01)
    root.keyframe_insert(data_path="location", frame=start_frame)
    root.keyframe_insert(data_path="scale", frame=start_frame)
    root.scale = (1, 1, 1)
    root.keyframe_insert(data_path="scale", frame=min(start_frame + 5, end_frame))
    root.location = (0, approach_y, 0.0)
    root.keyframe_insert(data_path="location", frame=end_frame)
    context["ship_blocked_y"] = approach_y


def op_block_ship(op, context, start_frame, end_frame):
    root = context.get("sailing_ship")
    if root is None:
        return
    blocked_y = float(op.get("blocked_y", context.get("ship_blocked_y", 1.2)))
    root.location = (0, blocked_y, 0.0)
    root.keyframe_insert(data_path="location", frame=start_frame)
    root.keyframe_insert(data_path="location", frame=end_frame)


def op_raise_deck(op, context, start_frame, end_frame):
    amount = float(op.get("amount", 0.2))
    for obj in context.get("bridge_objects", []):
        start_z = obj.location.z
        obj.location.z = start_z
        obj.keyframe_insert(data_path="location", frame=start_frame)
        obj.location.z = start_z + amount
        obj.keyframe_insert(data_path="location", frame=end_frame)


def op_extend_approaches(op, context, start_frame, end_frame):
    wood = context["materials"]["wood"]
    span = context.get("span", 8.8)
    deck_width = context.get("deck_width", 1.2)
    deck_z = context.get("deck_z", 1.55) + float(op.get("amount_lifted", 0.2))
    length = float(op.get("length", 3.2))
    for sign in (-1, 1):
        center_x = sign * (span / 2 + length / 2)
        ramp = add_cube(
            f"Long wooden approach ramp {sign:+d}",
            (center_x, 0, deck_z - 0.1),
            (length, deck_width, 0.22),
            wood,
            0.05,
        )
        ramp.rotation_euler[1] = math.radians(-sign * 7)
        ramp.scale.x = 0.01
        ramp.location.x = sign * (span / 2 + 0.1)
        ramp.keyframe_insert(data_path="scale", frame=start_frame)
        ramp.keyframe_insert(data_path="location", frame=start_frame)
        ramp.scale.x = 1.0
        ramp.location.x = center_x
        ramp.keyframe_insert(data_path="scale", frame=end_frame)
        ramp.keyframe_insert(data_path="location", frame=end_frame)
        context["bridge_objects"].append(ramp)


OPERATIONS = {
    "river": op_river,
    "add_rocks": op_add_rocks,
    "drop_deck": op_drop_deck,
    "add_piers": op_add_piers,
    "reduce_piers": op_reduce_piers,
    "raise_towers": op_raise_towers,
    "hang_ropes": op_hang_ropes,
    "spawn_yacht": op_spawn_yacht,
    "pass_yacht": op_pass_yacht,
    "spawn_ship": op_spawn_ship,
    "block_ship": op_block_ship,
    "raise_deck": op_raise_deck,
    "extend_approaches": op_extend_approaches,
    "reveal_full_bridge": lambda op, context, *frames: None,
}


def smooth_keyframes():
    for action in bpy.data.actions:
        for fcurve in getattr(action, "fcurves", []):
            for keyframe in fcurve.keyframe_points:
                keyframe.interpolation = "BEZIER"
                keyframe.handle_left_type = "AUTO_CLAMPED"
                keyframe.handle_right_type = "AUTO_CLAMPED"


def build(timeline, width: int, height: int, fps: int, samples: int):
    scene = setup_scene(timeline, width, height, fps, samples)
    context = {"materials": {}, "bridge_objects": []}
    create_camera(scene, timeline, fps)
    add_lighting()

    for beat in timeline["beats"]:
        start_frame = frame_at(beat["start"], fps)
        end_frame = frame_at(beat["start"] + beat["dur"], fps)
        for operation in beat["ops"]:
            name = operation["op"]
            if name not in OPERATIONS:
                raise ValueError(f"Unknown timeline operation {name!r} in beat {beat['id']!r}")
            function = OPERATIONS[name]
            if name == "spawn_yacht":
                function(operation, context, start_frame, end_frame, fps)
            elif name in {"drop_deck", "add_piers", "reduce_piers", "raise_towers", "hang_ropes", "pass_yacht", "spawn_ship", "block_ship", "raise_deck", "extend_approaches"}:
                function(operation, context, start_frame, end_frame)
            else:
                function(operation, context)

    smooth_keyframes()
    scene.frame_set(1)
    bpy.context.view_layer.update()
    return scene


def main():
    arguments = args_after_separator()
    timeline_path = Path(arguments.timeline).expanduser().resolve()
    timeline = json.loads(timeline_path.read_text(encoding="utf-8"))
    width = arguments.width or int(timeline["width"])
    height = arguments.height or int(timeline["height"])
    fps = arguments.fps or int(timeline["fps"])
    scene = build(timeline, width, height, fps, arguments.samples)
    scene.render.filepath = str(Path(arguments.render_output).expanduser().resolve())
    if arguments.format == "ffmpeg":
        # Some official Windows Blender builds omit FFmpeg from their render
        # output enum. Render lossless PNG frames and let the wrapper encode.
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGB"
    else:
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"
    output_path = Path(arguments.out).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output_path))
    print(f"Built {output_path} using Blender {bpy.app.version_string}; engine={scene.render.engine}; resolution={width}x{height}; fps={fps}")


if __name__ == "__main__":
    main()
