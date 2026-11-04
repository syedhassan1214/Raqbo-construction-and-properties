"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import * as THREE from "three";

type PanoramaViewerProps = {
  src: string;
  label: string;
};

export default function PanoramaViewer({ src, label }: PanoramaViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const viewerContainer = container;

    let active = true;
    let frame = 0;
    let yaw = 0;
    let pitch = 0;
    let pointerX = 0;
    let pointerY = 0;
    let dragging = false;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = "panorama-canvas";
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute("aria-label", `${label}. Drag to look around; use arrow keys to rotate.`);
    viewerContainer.prepend(renderer.domElement);

    const geometry = new THREE.SphereGeometry(500, 64, 40);
    const material = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
    const sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);

    function resize() {
      const { width, height } = viewerContainer.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    function updateView() {
      pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
      camera.lookAt(
        Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        Math.cos(yaw) * Math.cos(pitch),
      );
    }

    function render() {
      updateView();
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(render);
    }

    function onPointerDown(event: PointerEvent) {
      dragging = true;
      pointerX = event.clientX;
      pointerY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.classList.add("is-dragging");
    }

    function onPointerMove(event: PointerEvent) {
      if (!dragging) return;
      yaw -= (event.clientX - pointerX) * 0.005;
      pitch += (event.clientY - pointerY) * 0.005;
      pointerX = event.clientX;
      pointerY = event.clientY;
    }

    function onPointerUp() {
      dragging = false;
      renderer.domElement.classList.remove("is-dragging");
    }

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      camera.fov = Math.max(40, Math.min(100, camera.fov + event.deltaY * 0.03));
      camera.updateProjectionMatrix();
    }

    function onKeyDown(event: KeyboardEvent) {
      const rotationStep = 0.12;
      if (event.key === "ArrowLeft") yaw -= rotationStep;
      else if (event.key === "ArrowRight") yaw += rotationStep;
      else if (event.key === "ArrowUp") pitch += rotationStep;
      else if (event.key === "ArrowDown") pitch -= rotationStep;
      else if (event.key === "+" || event.key === "=") camera.fov = Math.max(40, camera.fov - 5);
      else if (event.key === "-") camera.fov = Math.min(100, camera.fov + 5);
      else return;
      event.preventDefault();
      camera.updateProjectionMatrix();
    }

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("keydown", onKeyDown);
    const observer = new ResizeObserver(resize);
    observer.observe(viewerContainer);
    resize();

    new THREE.TextureLoader().load(
      src,
      (texture) => {
        if (!active) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        material.map = texture;
        material.needsUpdate = true;
        setStatus("ready");
        render();
      },
      undefined,
      () => {
        if (active) setStatus("error");
      },
    );

    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("keydown", onKeyDown);
      geometry.dispose();
      material.map?.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [label, src]);

  return (
    <div className="panorama-viewer" ref={containerRef} aria-label={label}>
      {status === "loading" && <div className="panorama-viewer-status" role="status">Loading 360° panorama…</div>}
      {status === "error" && (
        <div className="panorama-viewer-error" role="alert">
          <p>The interactive panorama could not be loaded. You can still view the image below.</p>
          <Image src={src} alt={label} width={960} height={540} unoptimized />
        </div>
      )}
      {status === "ready" && <span className="panorama-viewer-hint">Drag to look around · Scroll or use +/− to zoom</span>}
    </div>
  );
}
