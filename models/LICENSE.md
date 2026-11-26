# 3D muscle model: credits and license

`muscles.glb` is **not** covered by the rest of this project's terms. It is licensed under
**[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)**.

- **Source of this file:** `muscles.glb` from
  [kalibismail/gymmetry-muscle-model](https://github.com/kalibismail/gymmetry-muscle-model)
  at commit `bd78e29f969e89dd6eec060ab3910416be452eeb`
  (SHA-256 `d7ed0fea723cb4d7eef28ab9c1a0f9559ccb81197712f59a4a7c4e57fc070017`), used unmodified.
- **Adapted from:** [Z-Anatomy — The libre 3D atlas of anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy)
  by Gauthier Kervyn (Blender add-on credited to Marcin Zielinski), licensed CC BY-SA 4.0
  ([license and required credits](https://github.com/Z-Anatomy/Models-of-human-anatomy#license)).
- **Based on:** [BodyParts3D](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html),
  © The Database Center for Life Science (Kousaku Okubo), licensed
  [CC BY-SA 2.1 Japan](https://creativecommons.org/licenses/by-sa/2.1/jp/).

The upstream repository describes its changes from Z-Anatomy: explicitly named muscle meshes
selected and grouped into regions, decimated, original textures and materials removed, ambient
occlusion baked into vertex colours, scale normalised, plus head, bone, tendon and skin context
shapes. See its README for the full list.

LiftLog does not modify the file. It loads it as is and assigns its own colours (materials) at
run time. If you redistribute a modified version of `muscles.glb`, it must stay CC BY-SA 4.0 and
keep these credits.
