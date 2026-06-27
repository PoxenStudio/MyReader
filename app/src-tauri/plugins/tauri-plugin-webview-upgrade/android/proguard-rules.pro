# This module is shipped as an AAR; its consumer-rules.pro propagates to
# the host app and that's where R8 actually runs. This file is only used
# if the library itself is minified standalone, which Readest's build does
# not do. Leaving the same rules here for completeness.
-keep class com.norman.webviewup.lib.** { *; }
-keepattributes RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations,RuntimeVisibleTypeAnnotations,AnnotationDefault
