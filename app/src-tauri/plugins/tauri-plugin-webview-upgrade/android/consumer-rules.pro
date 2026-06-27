# WebViewUpgrade reflectively binds to hidden AOSP classes via runtime
# annotations (@ClassName / @Field / @Method / @ClassType / @ParameterType)
# on interfaces in service.interfaces.* AND on abstract proxy classes in
# service.proxy.* that the hooks subclass. R8 keeps reachable superclasses
# but strips their annotations unless they're explicitly kept, which breaks
# getClass().getAnnotation(ClassName.class) inside RuntimeProxy.get() and
# surfaces as `Class.forName(null) -> NPE` at upgrade time.
#
# The library is small (<60 classes) and entirely reflection-driven; whitelist
# it wholesale rather than chase per-package keep rules. These rules apply to
# the host app's R8 step automatically via consumerProguardFiles.
-keep class com.norman.webviewup.lib.** { *; }
-keepattributes RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations,RuntimeVisibleTypeAnnotations,AnnotationDefault
